// T2: mock Jev and OpenAI Decisions responses, validated against documented schemas.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSearchGateway} from '../../packages/search-gateway/dist/core.js';
import {fakeProvider, json} from '../helpers/mock.mjs';

const base = {providerKeys: {exa: 'm', tavily: 'm'}, adapters: [fakeProvider('exa'), fakeProvider('tavily')]};
test('Jev is first; choice map and noul support multi-provider dispatch', async () => {
  const calls = [];
  const g = createSearchGateway({...base, router: {jevApiKey: 'jev-mock', openaiApiKey: 'openai-mock'}, fetch: async (url, init) => {
    const body = JSON.parse(init.body); calls.push(url);
    assert.equal(body.model, 'jev-latest'); assert.equal(body.state.query, 'compare x'); assert.equal(body.questions.provider.type, 'choice');
    assert.deepEqual(Object.keys(body.questions.provider.criteria), ['exa', 'tavily']); assert.equal(body.questions.breadth.type, 'noul');
    return json({answers: {provider: {type: 'choice', choice: 'exa', confidence: 0.9, probabilities: {exa: 0.8, tavily: 0.2}}, breadth: {noul: 0.95}}});
  }});
  const r = await g.search({query: 'compare x'}); assert.deepEqual(calls, ['https://api.typesafe.ai/v1/systemone']); assert.equal(r.routing.router, 'jev'); assert.deepEqual(r.routing.providers, ['exa', 'tavily']);
});
test('low-confidence Jev falls back to OpenAI Decisions choice array and predicate', async () => {
  const calls = [];
  const g = createSearchGateway({...base, router: {jevApiKey: 'j', openaiApiKey: 'o'}, fetch: async (url, init) => {
    const body = JSON.parse(init.body); calls.push(url);
    if (url.includes('typesafe')) return json({answers: {provider: {type: 'choice', choice: 'exa', confidence: 0.1}}});
    assert.equal(body.model, 'gpt-6-luna'); assert.equal(body.questions[0].type, 'choice'); assert.equal(body.questions[1].type, 'predicate');
    assert.deepEqual(body.questions[0].choices.map(c => c.value), ['exa', 'tavily']);
    return json({answers: [{name: 'provider', type: 'choice', choice: 'tavily', confidence: 0.8, probabilities: [{value: 'tavily', probability: 1}]}, {name: 'breadth', type: 'predicate', probability: 0.1}]});
  }});
  const r = await g.search({query: 'x'}); assert.equal(calls.length, 2); assert.equal(r.routing.router, 'openai-decisions'); assert.deepEqual(r.routing.providers, ['tavily']); assert.equal(r.errors[0].operation, 'routing');
});
test('invalid model choice fails closed to rules and cannot choose disabled providers', async () => {
  const g = createSearchGateway({...base, router: {jevApiKey: 'j'}, fetch: async () => json({answers: {provider: {type: 'choice', choice: 'brave', confidence: 1}}})});
  const r = await g.search({query: 'x', excludeProviders: ['tavily']}); assert.equal(r.routing.router, 'rules'); assert.deepEqual(r.routing.providers, ['exa']);
});
test('explicit modes avoid paid routing requests', async () => {
  const g = createSearchGateway({...base, router: {jevApiKey: 'j'}, fetch: async () => {throw new Error('must not call');}});
  assert.equal((await g.search({query: 'x', mode: 'single', providers: ['exa']})).routing.router, 'explicit');
});
