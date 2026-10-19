// T2: fabricated adapters exercise policy, ranking, fallback and source content semantics.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSearchGateway} from '../../packages/search-gateway/dist/core.js';
import {fakeProvider} from '../helpers/mock.mjs';

test('parallel calls start together and merge by reciprocal rank with discovery provenance', async () => {
  let started = 0; let release;
  const barrier = new Promise(r => {release = r;});
  const adapter = (id, urls) => ({...fakeProvider(id), search: async () => {if (++started === 2) release(); await barrier; return {sources: urls.map(url => ({url, title: id}))};}});
  const g = createSearchGateway({providerKeys: {exa: 'mock', tavily: 'mock'}, adapters: [adapter('exa', ['https://example.com/a', 'https://example.com/b']), adapter('tavily', ['https://example.com/b', 'https://example.com/c'])]});
  const r = await g.search({query: 'x', mode: 'parallel', providers: ['exa', 'tavily']});
  assert.equal(started, 2); assert.equal(r.sources[0].url, 'https://example.com/b'); assert.deepEqual(r.sources[0].providers, ['exa', 'tavily']);
});
test('fallback stops on the first useful result, and skips failures/empty results', async () => {
  const called = [];
  const adapter = id => ({...fakeProvider(id), search: async () => {called.push(id); if (id === 'exa') throw new Error('failure'); return {sources: [{url: 'https://example.com/a'}]};}});
  const g = createSearchGateway({providerKeys: {exa: 'm', tavily: 'm', brave: 'm'}, adapters: ['exa', 'tavily', 'brave'].map(adapter)});
  const r = await g.search({query: 'x', mode: 'fallback', providers: ['exa', 'tavily', 'brave'], maxProviders: 3});
  assert.deepEqual(called, ['exa', 'tavily']); assert.equal(r.errors.length, 1); assert.equal(r.sources.length, 1);
});
test('enabled policy cannot be bypassed with request keys or explicit provider names', async () => {
  const g = createSearchGateway({enabledProviders: ['tavily'], providerKeys: {exa: 'mock'}});
  await assert.rejects(g.search({query: 'x', providers: ['exa'], providerKeys: {exa: 'mock'}}), {code: 'provider_unavailable'});
});
test('request keys override local credentials only for the request', async () => {
  const observed = [];
  const g = createSearchGateway({providerKeys: {exa: 'stored'}, adapters: [{...fakeProvider('exa'), search: async (_r, c) => {observed.push(c.key); return {sources: []};}}]});
  await g.search({query: 'x', providerKeys: {exa: 'request'}}); await g.search({query: 'x'});
  assert.deepEqual(observed, ['request', 'stored']);
});
test('source enrichment is separate from snippets and obeys text limits', async () => {
  const g = createSearchGateway({providerKeys: {brave: 'm', exa: 'm'}, adapters: [fakeProvider('brave'), fakeProvider('exa', [], async urls => ({sources: urls.map(url => ({url, text: 'A long full page'}))}))]});
  const r = await g.search({query: 'x', providers: ['brave'], mode: 'single', content: 'text', maxContentChars: 5});
  assert.equal(r.sources[0].snippet, 'mock snippet'); assert.deepEqual(r.sources[0].content, {text: 'A lon', format: 'text', truncated: true, provider: 'exa'});
});
test('domain policies filter subdomains correctly and do not expose unfilterable generated answers', async () => {
  const g = createSearchGateway({providerKeys: {exa: 'm'}, adapters: [{...fakeProvider('exa'), search: async () => ({answer: 'unfiltered answer', sources: [{url: 'https://news.example.com/a'}, {url: 'https://evil-example.com/a'}, {url: 'https://blocked.example.com/a'}]})}]});
  const r = await g.search({query: 'x', includeDomains: ['example.com'], excludeDomains: ['blocked.example.com']});
  assert.deepEqual(r.sources.map(s => s.url), ['https://news.example.com/a']); assert.deepEqual(r.answers, []);
});
test('no content provider yields a warning, not snippets relabeled as pages', async () => {
  const g = createSearchGateway({providerKeys: {brave: 'm'}, adapters: [fakeProvider('brave')]});
  const r = await g.search({query: 'x', content: 'text'}); assert.equal(r.sources[0].content, undefined); assert.ok(r.warnings.length);
});
test('deadline bounds even a custom adapter that ignores AbortSignal', async () => {
  const g = createSearchGateway({providerKeys: {exa: 'm'}, adapters: [{...fakeProvider('exa'), search: () => new Promise(() => {})}]});
  await assert.rejects(g.search({query: 'x', timeoutMs: 100}), {status: 504});
});
test('custom routing and configured keyword rules honor candidate availability', async () => {
  const base = {providerKeys: {exa: 'm', tavily: 'm'}, adapters: [fakeProvider('exa'), fakeProvider('tavily')]};
  const g = createSearchGateway({...base, router: {rules: [{contains: ['custom'], providers: ['tavily']}]}});
  assert.deepEqual((await g.search({query: 'custom query'})).routing.providers, ['tavily']);
  const bad = createSearchGateway({...base, router: {decide: () => ['brave']}});
  await assert.rejects(bad.search({query: 'x'}), {code: 'invalid_route'});
});
