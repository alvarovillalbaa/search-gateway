// T2: provider request/response contracts based on primary docs; no live-provider proof.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {builtinProviders, createSearchGateway, PROVIDERS} from '../../packages/search-gateway/dist/core.js';
import {fixture, json} from '../helpers/mock.mjs';

const endpoints = {
  exa: ['api.exa.ai', '/search', 'x-api-key'], tavily: ['api.tavily.com', '/search', 'Authorization'],
  brave: ['api.search.brave.com', '/res/v1/web/search', 'X-Subscription-Token'], serper: ['google.serper.dev', '/search', 'X-API-KEY'],
  serpapi: ['serpapi.com', '/search.json', null], you: ['ydc-index.io', '/v1/search', 'X-API-Key'],
  perplexity: ['api.perplexity.ai', '/search', 'Authorization'], parallel: ['api.parallel.ai', '/v1/search', 'x-api-key'],
  firecrawl: ['api.firecrawl.dev', '/v2/search', 'Authorization'], jina: ['s.jina.ai', '/mock%20query', 'Authorization'],
  linkup: ['api.linkup.so', '/v1/search', 'Authorization'], openai: ['api.openai.com', '/v1/responses', 'Authorization'],
  happenstance: ['api.happenstance.ai', '/v1/search', 'Authorization'],
};
test('registry contains all 13 documented providers exactly once', () => assert.deepEqual([...builtinProviders.map(p => p.id)].sort(), [...PROVIDERS].sort()));
for (const id of PROVIDERS) test(`${id}: auth, endpoint, query and normalized source`, async () => {
  const calls = [];
  const gateway = createSearchGateway({providerKeys: {[id]: 'mock-provider-key'}, fetch: async (url, init) => {
    calls.push({url: new URL(url), init, body: init.body && JSON.parse(init.body)});
    if (id === 'happenstance' && init.method === 'POST') return json({id: 'search-1', url: 'https://happenstance.ai/search/test'});
    return json(fixture[id]);
  }});
  const result = await gateway.search({query: 'mock query', providers: [id], mode: 'single', content: 'text', fetchMissingContent: false});
  assert.equal(result.sources.length, 1);
  assert.deepEqual(result.sources[0].providers, [id]);
  assert.ok(result.sources[0].url.startsWith('https://'));
  assert.ok(!result.sources[0].url.includes('utm_'));
  const [host, path, header] = endpoints[id];
  assert.equal(calls[0].url.hostname, host); assert.equal(calls[0].url.pathname, path);
  if (header) assert.equal(calls[0].init.headers[header], header === 'Authorization' ? 'Bearer mock-provider-key' : 'mock-provider-key');
  else assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(calls[0].init.redirect, 'error');
  const request = calls[0].body ?? Object.fromEntries(calls[0].url.searchParams);
  assert.equal(id === 'jina' ? decodeURIComponent(calls[0].url.pathname.slice(1)) : request.query ?? request.q ?? request.objective ?? request.input ?? request.text, 'mock query');
  if (id === 'exa') { assert.equal(request.contents.text.maxCharacters, 12_000); assert.equal(request.numResults, 10); }
  if (id === 'tavily') assert.equal(request.include_raw_content, 'markdown');
  if (id === 'you') assert.equal(request.extraction.extraction_mode, 'full_page');
  if (id === 'firecrawl') assert.deepEqual(request.scrapeOptions.formats, ['markdown']);
  if (id === 'parallel') assert.equal(request.mode, 'basic');
  if (id === 'serpapi') assert.equal(request.api_key, 'mock-provider-key');
  if (id === 'openai') { assert.equal(result.answers[0].text, 'A generated answer'); assert.equal(result.sources[0].snippet, ''); assert.equal(result.sources[0].content, undefined); assert.equal(request.store, false); }
  if (id === 'happenstance') { assert.equal(calls.length, 2); assert.equal(calls[1].url.pathname, '/v1/search/search-1'); assert.equal(result.sources[0].content, undefined); assert.equal(result.sources[0].snippet, 'Founder at Example'); }
});
for (const id of ['exa', 'tavily', 'parallel', 'firecrawl', 'jina']) test(`${id}: full URL extraction contract`, async () => {
  const calls = [];
  const adapter = builtinProviders.find(p => p.id === id);
  const fetcher = async (url, init) => {
    calls.push({url: new URL(url), body: init.body && JSON.parse(init.body)});
    if (id === 'firecrawl') return json({success: true, data: {metadata: {title: 'A'}, markdown: 'Full page'}});
    if (id === 'jina') return json({data: {title: 'A', content: 'Full page'}});
    return json(fixture[id]);
  };
  const result = await adapter.contents(['https://example.com/a'], 20, {fetch: fetcher, key: 'mock-key', signal: AbortSignal.timeout(1000)});
  assert.equal(result.sources.length, 1); assert.equal(typeof result.sources[0].text, 'string');
  if (id === 'parallel') assert.deepEqual(calls[0].body, {urls: ['https://example.com/a'], advanced_settings: {full_content: true}});
  if (id === 'exa') assert.deepEqual(calls[0].body.urls, ['https://example.com/a']);
  if (id === 'jina') assert.equal(calls[0].url.hostname, 'r.jina.ai');
});
test('provider HTTP failures never expose upstream body secrets', async () => {
  const gateway = createSearchGateway({providerKeys: {exa: 'mock-secret'}, fetch: async () => json({error: 'mock-secret'}, 401)});
  await assert.rejects(gateway.search({query: 'x'}), e => e.code === 'all_providers_failed' && !e.message.includes('mock-secret'));
});
test('Happenstance FAILED is terminal and does not restart the paid job', async () => {
  let posts = 0;
  const gateway = createSearchGateway({providerKeys: {happenstance: 'mock-key'}, fetch: async (_url, init) => init.method === 'POST' ? (posts++, json({id: 'search-1'})) : json({status: 'FAILED'})});
  await assert.rejects(gateway.search({query: 'x'}), {code: 'all_providers_failed'}); assert.equal(posts, 1);
});
