// Generate the portable HTTP schema from the public provider registry and explicit wire fields.
import {writeFile} from 'node:fs/promises';
import {PROVIDERS} from '../packages/search-gateway/dist/core.js';
const ref = name => ({$ref: `#/components/schemas/${name}`});
const array = items => ({type: 'array', items});
const provider = {type: 'string', enum: [...PROVIDERS]};
const object = (properties, required = Object.keys(properties)) => ({type: 'object', properties, required, additionalProperties: false});
const integer = (minimum, maximum, value) => ({type: 'integer', minimum, maximum, ...(value === undefined ? {} : {default: value})});
const providerList = {...array(provider), minItems: 1, maxItems: 13};
const providerKeys = {type: 'object', properties: Object.fromEntries(PROVIDERS.map(id => [id, {type: 'string', minLength: 1, maxLength: 4096, writeOnly: true}])), additionalProperties: false};
const source = object({id: {type: 'string'}, url: {type: 'string', format: 'uri'}, title: {type: 'string'}, snippet: {type: 'string'}, providers: array(provider), rank: {type: 'integer'}, publishedAt: {type: 'string'}, content: ref('SourceContent')}, ['id', 'url', 'title', 'snippet', 'providers', 'rank']);
const schemas = {
  SearchRequest: object({query: {type: 'string', minLength: 1, maxLength: 8000}, mode: {type: 'string', enum: ['auto', 'single', 'parallel', 'fallback'], default: 'auto'}, providers: providerList, excludeProviders: array(provider), limit: integer(1, 50, 10), maxProviders: integer(1, 5, 2), content: {type: 'string', enum: ['none', 'text'], default: 'none'}, maxContentChars: integer(1, 100000, 12000), fetchMissingContent: {type: 'boolean', default: true}, includeDomains: {...array({type: 'string'}), maxItems: 100}, excludeDomains: {...array({type: 'string'}), maxItems: 100}, timeoutMs: integer(100, 120000, 20000), providerOptions: {type: 'object', properties: Object.fromEntries(PROVIDERS.map(id => [id, {type: 'object', additionalProperties: true}])), additionalProperties: false}, providerKeys}, ['query']),
  ContentsRequest: object({urls: {...array({type: 'string', format: 'uri'}), minItems: 1, maxItems: 20}, provider, maxContentChars: integer(1, 100000, 12000), timeoutMs: integer(100, 120000, 20000), providerKeys}, ['urls']),
  Source: source,
  SourceContent: object({text: {type: 'string'}, format: {type: 'string', enum: ['text', 'markdown']}, provider, truncated: {type: 'boolean'}}),
  ProviderError: object({provider: {type: 'string', enum: [...PROVIDERS, 'jev', 'openai-decisions']}, operation: {type: 'string', enum: ['search', 'contents', 'routing']}, code: {type: 'string'}, retryable: {type: 'boolean'}}),
  RoutingDecision: object({router: {type: 'string', enum: ['jev', 'openai-decisions', 'rules', 'custom', 'explicit']}, providers: array(provider), reason: {type: 'string'}, confidence: {type: 'number', minimum: 0, maximum: 1}}, ['router', 'providers', 'reason']),
  Attempt: object({provider, operation: {type: 'string', enum: ['search', 'contents']}, status: {type: 'string', enum: ['ok', 'error']}, elapsedMs: {type: 'number'}}),
  SearchResponse: object({id: {type: 'string'}, query: {type: 'string'}, sources: array(ref('Source')), answers: array(object({provider, text: {type: 'string'}})), routing: ref('RoutingDecision'), attempts: array(ref('Attempt')), errors: array(ref('ProviderError')), warnings: array({type: 'string'}), elapsedMs: {type: 'number'}}),
  ContentsResponse: object({id: {type: 'string'}, sources: array(ref('Source')), errors: array(ref('ProviderError')), warnings: array({type: 'string'}), elapsedMs: {type: 'number'}}),
  ProviderInfo: object({id: provider, description: {type: 'string'}, contents: {type: 'boolean'}, configured: {type: 'boolean'}, enabled: {type: 'boolean'}}),
  Error: object({error: object({code: {type: 'string'}, message: {type: 'string'}})}),
};
const response = (description, schema) => ({description, content: {'application/json': {schema}}});
const errors = Object.fromEntries([400, 401, 403, 413, 415, 429, 502, 503, 504].map(status => [status, response('Gateway error; see API.md for codes', ref('Error'))]));
const post = (name, description) => ({summary: description, operationId: name.toLowerCase(), requestBody: {required: true, content: {'application/json': {schema: ref(`${name}Request`)}}}, responses: {'200': response('Successful operation, possibly with partial results and warnings', ref(`${name}Response`)), ...errors}});
const api = {openapi: '3.1.0', info: {title: 'Search Gateway', version: '0.1.0', description: 'Self-hosted AI search. See API.md for policy semantics and provider-specific limits.', license: {name: 'MIT'}}, servers: [{url: 'http://127.0.0.1:8787'}], security: [{GatewayKey: []}], paths: {'/health': {get: {summary: 'Public health check', security: [], responses: {'200': response('Healthy process', object({status: {const: 'ok'}, version: {type: 'string'}}))}}}, '/v1/search': {post: post('Search', 'Search enabled providers')}, '/v1/contents': {post: post('Contents', 'Retrieve page text for public URLs')}, '/v1/providers': {get: {summary: 'List providers in the gateway key scope', responses: {'200': response('Provider catalog', object({providers: array(ref('ProviderInfo'))})), '401': errors['401']}}}}, components: {securitySchemes: {GatewayKey: {type: 'http', scheme: 'bearer'}}, schemas}};
await writeFile(new URL('../openapi.json', import.meta.url), `${JSON.stringify(api, null, 2)}\n`);
