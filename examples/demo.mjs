// A complete, credential-free in-process demo using explicitly fabricated data.
import {createSearchGateway} from '../packages/search-gateway/dist/core.js';
import {createSearchTool} from '../packages/search-gateway/dist/index.js';

const gateway = createSearchGateway({
  providerKeys: {exa: 'demo-only'},
  adapters: [{
    id: 'exa', description: 'Fabricated demo search',
    search: async () => ({sources: [{url: 'https://example.com/retrieval', title: 'Demo source (mock)', snippet: 'A fabricated excerpt.', text: 'Fabricated page content for the credential-free demo.'}]}),
  }],
});
const result = await createSearchTool(gateway).execute({query: 'How does Search Gateway work?', content: 'text'});
console.log(JSON.stringify({demo: true, ...result}, null, 2));
