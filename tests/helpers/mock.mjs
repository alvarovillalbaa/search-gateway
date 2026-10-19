// T2: fabricated provider data. Never makes outbound network requests.
export const fixture = {
  exa: {results: [{url: 'https://example.com/a?utm_source=mock', title: 'A', text: 'Full exa page text', highlights: ['A snippet']}]},
  tavily: {results: [{url: 'https://example.com/a', title: 'A', content: 'A snippet', raw_content: 'Full tavily page text'}]},
  brave: {web: {results: [{url: 'https://example.com/a', title: 'A', description: 'A snippet'}]}},
  serper: {organic: [{link: 'https://example.com/a', title: 'A', snippet: 'A snippet'}]},
  serpapi: {organic_results: [{link: 'https://example.com/a', title: 'A', snippet: 'A snippet'}]},
  you: {results: {web: [{url: 'https://example.com/a', title: 'A', snippets: ['A snippet'], contents: {markdown: 'Full you page text'}}]}},
  perplexity: {results: [{url: 'https://example.com/a', title: 'A', snippet: 'A snippet', date: '2026-01-01'}]},
  parallel: {results: [{url: 'https://example.com/a', title: 'A', excerpts: ['A snippet'], full_content: 'Full parallel page text'}]},
  firecrawl: {success: true, data: {web: [{url: 'https://example.com/a', title: 'A', description: 'A snippet', markdown: 'Full firecrawl page text'}]}},
  jina: {data: [{url: 'https://example.com/a', title: 'A', description: 'A snippet', content: 'Full jina page text'}]},
  linkup: {results: [{url: 'https://example.com/a', name: 'A', content: 'A snippet'}]},
  openai: {output: [{type: 'web_search_call', action: {sources: [{url: 'https://example.com/a', title: 'A'}]}}, {type: 'message', content: [{type: 'output_text', text: 'A generated answer', annotations: [{type: 'url_citation', url: 'https://example.com/a', title: 'A'}]}]}]},
  happenstance: {id: 'search-1', status: 'COMPLETED', results: [{name: 'Test Person', current_title: 'Founder', current_company: 'Example', socials: {happenstance_url: 'https://happenstance.ai/u/test-person'}, summary: 'This generated summary is not page text'}]},
};
export const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json'}});
export function fakeProvider(id, sources = [{url: 'https://example.com/a', title: 'A', snippet: 'mock snippet'}], contents) {
  return {id, description: `${id} mock`, search: async () => ({sources}), ...(contents ? {contents} : {})};
}
