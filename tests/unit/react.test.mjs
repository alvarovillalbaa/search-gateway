// T2: jsdom + React DOM mount verifies latest-request and unmount behavior without a dev server.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {useSearchGateway} from '../../packages/search-gateway/dist/react.js';

test('React hook ignores stale responses, supports cancellation and handles errors', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let hook; const pending = [];
  const client = {search: (_r, {signal}) => new Promise((resolve, reject) => pending.push({resolve, reject, signal})), contents: async () => ({sources: []})};
  function App() { hook = useSearchGateway(client); return React.createElement('span', null, hook.loading ? 'loading' : hook.data?.query ?? 'empty'); }
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(App)));
    let first; await act(async () => { first = hook.search({query: 'old'}); });
    let second; await act(async () => { second = hook.search({query: 'new'}); });
    assert.equal(pending[0].signal.aborted, true);
    await act(async () => { pending[1].resolve({query: 'new'}); await second; });
    await act(async () => { pending[0].resolve({query: 'old'}); await first; });
    assert.equal(hook.data.query, 'new'); assert.equal(hook.loading, false);
    let failure; await act(async () => { failure = hook.search({query: 'bad'}).catch(e => e); });
    await act(async () => { pending[2].reject(new Error('test failure')); await failure; });
    assert.equal(hook.error.message, 'test failure'); assert.equal(hook.loading, false);
    let cancelled; await act(async () => { cancelled = hook.search({query: 'cancel'}); });
    await act(async () => hook.cancel()); assert.equal(hook.loading, false); assert.equal(pending[3].signal.aborted, true);
    await act(async () => { pending[3].resolve({query: 'cancel'}); await cancelled; });
    assert.equal(hook.data.query, 'new');
  } finally { await act(async () => root.unmount()); dom.window.close(); delete globalThis.window; delete globalThis.document; delete globalThis.IS_REACT_ACT_ENVIRONMENT; }
});
