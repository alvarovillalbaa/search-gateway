// T2: local interface abuse only; these tests assert defensive controls.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSearchGateway} from '../../packages/search-gateway/dist/core.js';
import {SearchGateway} from '../../packages/search-gateway/dist/index.js';
import {createGatewayServer} from '../../packages/search-gateway/dist/server.js';
import {fakeProvider} from '../helpers/mock.mjs';

const g = () => createSearchGateway({providerKeys: {exa: 'mock'}, adapters: [fakeProvider('exa')]});
test('content URL validation rejects credentials, private IPs, local names and custom ports', async () => {
  for (const url of ['file:///etc/passwd', 'http://127.0.0.1/', 'http://[::1]/', 'https://example.com:1234/', 'http://localhost/', 'https://user:secret@example.com/', 'https://host.internal/']) await assert.rejects(g().contents({urls: [url]}), {code: 'invalid_request'});
});
test('providerOptions cannot redirect endpoints or override auth', async () => {
  for (const name of ['baseUrl', 'endpoint', 'headers', 'api_key', 'Authorization', 'access_token']) await assert.rejects(g().search({query: 'x', providerOptions: {exa: {[name]: 'https://evil.example'}}}), {code: 'invalid_request'});
});
test('unknown request fields, malformed lists and oversized queries are rejected', async () => {
  for (const options of [{query: 'x', endpoint: 'evil'}, {query: 'x', excludeProviders: {length: 0}}, {query: 'x', limit: 1000}, {query: 'x', providers: ['unknown']}, {query: 'x'.repeat(8001)}]) await assert.rejects(g().search(options), {code: 'invalid_request'});
});
test('remote client connections require HTTPS and never follow credential-bearing redirects', () => {
  assert.throws(() => new SearchGateway({baseUrl: 'http://gateway.example'}), {code: 'insecure_base_url'});
  assert.throws(() => new SearchGateway({baseUrl: 'https://user:secret@example.com'}), {code: 'invalid_base_url'});
});
test('gateway origin allowlist, body cap and request-key opt-in fire locally', async t => {
  const server = createGatewayServer({gateway: g(), authenticate: () => ({id: 'test', name: 'test', requestsPerMinute: 60}), allowedOrigins: ['https://app.example'], maxBodyBytes: 256});
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = {Authorization: 'Bearer mock', 'Content-Type': 'application/json'};
  assert.equal((await fetch(base + '/v1/providers', {headers: {...headers, Origin: 'https://evil.example'}})).status, 403);
  assert.equal((await fetch(base + '/v1/providers', {headers: {...headers, Origin: 'https://app.example'}})).headers.get('access-control-allow-origin'), 'https://app.example');
  const r = await fetch(base + '/v1/search', {method: 'POST', headers, body: JSON.stringify({query: 'x', providerKeys: {exa: 'mock'}})});
  assert.equal(r.status, 403);
  const tooBig = await fetch(base + '/v1/search', {method: 'POST', headers, body: JSON.stringify({query: 'x'.repeat(300)})});
  assert.equal(tooBig.status, 413);
});
