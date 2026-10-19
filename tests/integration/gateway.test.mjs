// T2: loopback HTTP with fabricated upstream adapters, temporary gateway keys, and native SDKs.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, stat, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createSearchGateway} from '../../packages/search-gateway/dist/core.js';
import {createGatewayServer, createApiKey, listApiKeys, revokeApiKey, keyStoreAuthenticator} from '../../packages/search-gateway/dist/server.js';
import {SearchGateway} from '../../packages/search-gateway/dist/index.js';
import {fakeProvider} from '../helpers/mock.mjs';

const cli = new URL('../../packages/search-gateway/dist/cli.js', import.meta.url);
const extract = async urls => ({sources: urls.map(url => ({url, text: 'Full test page', format: 'markdown'}))});
export async function setup(t, keyOptions = {}, serverOptions = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'search-gateway-test-')); const path = join(dir, 'keys.json');
  const key = await createApiKey(path, keyOptions);
  const gateway = createSearchGateway({providerKeys: {exa: 'mock-exa', tavily: 'mock-tavily'}, adapters: [fakeProvider('exa', [{url: 'https://example.com/a', title: 'A', snippet: 'Snippet'}], extract), fakeProvider('tavily', [], extract)]});
  const server = createGatewayServer({gateway, authenticate: keyStoreAuthenticator(path), ...serverOptions});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(r => server.close(r)); await rm(dir, {recursive: true, force: true}); });
  return {dir, path, key, baseUrl, server, client: new SearchGateway({baseUrl, apiKey: key.apiKey})};
}
test('native TypeScript HTTP client searches, extracts, enumerates and sees immediate revocation', async t => {
  const s = await setup(t);
  const result = await s.client.search({query: 'x', content: 'text'});
  assert.equal(result.sources[0].content.text, 'Full test page');
  assert.equal((await s.client.contents({urls: ['https://example.com/a']})).sources[0].content.provider, 'exa');
  assert.equal((await s.client.providers()).length, 2);
  const disk = await readFile(s.path, 'utf8'); assert.ok(!disk.includes(s.key.apiKey)); assert.equal((await stat(s.path)).mode & 0o777, 0o600);
  assert.ok(!(await listApiKeys(s.path))[0].hash);
  await revokeApiKey(s.path, s.key.id); await assert.rejects(s.client.search({query: 'x'}), {code: 'unauthorized', status: 401});
});
test('scoped gateway keys cannot search or extract through other providers', async t => {
  const s = await setup(t, {providers: ['tavily']});
  await assert.rejects(s.client.search({query: 'x', providers: ['exa']}), {code: 'provider_forbidden'});
  await assert.rejects(s.client.contents({urls: ['https://example.com/a'], provider: 'exa'}), {code: 'provider_forbidden'});
  assert.deepEqual((await s.client.providers()).map(p => p.id), ['tavily']);
  assert.equal((await s.client.contents({urls: ['https://example.com/a']})).sources[0].content.provider, 'tavily');
});
test('HTTP gateway requires auth and returns bounded, non-reflective errors', async t => {
  const s = await setup(t);
  assert.equal((await fetch(s.baseUrl + '/health')).status, 200);
  assert.equal((await fetch(s.baseUrl + '/v1/providers')).status, 401);
  const response = await fetch(s.baseUrl + '/v1/search', {method: 'POST', headers: {Authorization: `Bearer ${s.key.apiKey}`, 'Content-Type': 'application/json'}, body: '{not-json'});
  assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'invalid_json');
});
test('gateway per-key rate limit returns Retry-After', async t => {
  const s = await setup(t, {requestsPerMinute: 1}); await s.client.providers();
  const r = await fetch(s.baseUrl + '/v1/providers', {headers: {Authorization: `Bearer ${s.key.apiKey}`}});
  assert.equal(r.status, 429); assert.ok(Number(r.headers.get('retry-after')) > 0);
});
test('BYOK HTTP opt-in preserves gateway key scopes', async t => {
  const s = await setup(t, {providers: ['exa']}, {allowRequestKeys: true});
  assert.equal((await s.client.search({query: 'x', providerKeys: {exa: 'byok-mock'}})).sources.length, 1);
  await assert.rejects(s.client.search({query: 'x', providerKeys: {tavily: 'byok-mock'}}), {code: 'provider_forbidden'});
});
test('Python installed-style imports call real loopback HTTP gateway in sync and async modes', async t => {
  const s = await setup(t);
  const source = `import asyncio, os\nfrom search_gateway import SearchGateway, AsyncSearchGateway, execute_search_tool\nc=SearchGateway()\nr=c.search('python', content='text', max_content_chars=9)\nassert r['sources'][0]['content']['text']=='Full test'\nassert c.contents(['https://example.com/a'])['sources'][0]['content']['text']=='Full test page'\nassert len(c.providers())==2\nassert execute_search_tool(c, {'query':'tool'})['query']=='tool'\nasync def main():\n r=await AsyncSearchGateway().search('async')\n assert r['query']=='async'\nasyncio.run(main())\nprint('Python HTTP SDK integration passed')`;
  const child = spawn(process.env.PYTHON ?? 'python3', ['-c', source], {env: {...process.env, PYTHONPATH: 'python', SEARCH_GATEWAY_URL: s.baseUrl, SEARCH_GATEWAY_API_KEY: s.key.apiKey}, stdio: ['ignore', 'pipe', 'pipe']});
  let out = ''; child.stdout.on('data', b => out += b); child.stderr.on('data', b => out += b);
  assert.equal(await new Promise(r => child.on('exit', r)), 0, out); assert.match(out, /integration passed/);
});
test('MCP stdio negotiates, lists tools and executes through the HTTP SDK', async t => {
  const s = await setup(t);
  const child = spawn(process.execPath, [cli.pathname, 'mcp', '--base-url', s.baseUrl, '--providers', 'exa'], {env: {...process.env, SEARCH_GATEWAY_API_KEY: s.key.apiKey}, stdio: ['pipe', 'pipe', 'pipe']});
  let output = ''; child.stdout.on('data', b => output += b);
  const requests = [{jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'test', version: '1'}}}, {jsonrpc: '2.0', method: 'notifications/initialized'}, {jsonrpc: '2.0', id: 2, method: 'tools/list'}, {jsonrpc: '2.0', id: 3, method: 'tools/call', params: {name: 'web_search', arguments: {query: 'mcp'}}}];
  child.stdin.end(requests.map(JSON.stringify).join('\n') + '\n');
  assert.equal(await new Promise(r => child.on('exit', r)), 0);
  const responses = output.trim().split('\n').map(JSON.parse);
  assert.equal(responses[0].result.protocolVersion, '2025-11-25'); assert.equal(responses[1].result.tools.length, 2);
  assert.equal(JSON.parse(responses[2].result.content[0].text).sources[0].title, 'A');
});
