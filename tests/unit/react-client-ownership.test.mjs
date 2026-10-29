// T2: real React DOM/jsdom, controlled clients and deferred promises. No network or provider calls.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React, {act, useLayoutEffect} from 'react';
import {createRoot} from 'react-dom/client';

const hookSource = new URL(process.env.SEARCH_GATEWAY_REACT_HOOK_SOURCE ?? '../../packages/search-gateway/src/react.ts', import.meta.url);
if (hookSource.protocol !== 'file:') throw new Error('The hook fixture requires a local source file');
const {useSearchGateway} = await import(hookSource.href);

function response(query) {
  return {id: `fixture-${query}`, query, sources: [], answers: [], routing: {router: 'explicit', providers: [], reason: 'Authored fixture'}, attempts: [], errors: [], warnings: [], elapsedMs: 0};
}

function client(name) {
  const pending = [];
  return {
    name,
    pending,
    search(request, {signal}) {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      pending.push({request, signal, resolve, reject});
      return promise;
    },
    contents: async () => ({id: 'fixture-contents', sources: [], errors: [], warnings: [], elapsedMs: 0}),
  };
}

async function mounted(run, {strict = false} = {}) {
  const dom = new JSDOM('<div id="root"></div>');
  const names = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'];
  const originals = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  for (const [name, value] of [['window', dom.window], ['document', dom.window.document], ['IS_REACT_ACT_ENVIRONMENT', true]]) {
    Object.defineProperty(globalThis, name, {value, configurable: true, writable: true});
  }
  let hook, closed = false;
  const history = [];
  function LayoutRequest({start, api}) {
    useLayoutEffect(() => { start?.(api); }, [start]);
    return null;
  }
  function App({service, start}) {
    hook = useSearchGateway(service);
    history.push({service, data: hook.data, error: hook.error, loading: hook.loading});
    return React.createElement(React.Fragment, null,
      React.createElement('span', null, hook.loading ? 'loading' : hook.data?.query ?? 'empty'),
      React.createElement(LayoutRequest, {start, api: hook}));
  }
  const root = createRoot(document.getElementById('root'));
  const fixture = {
    get hook() { return hook; },
    history,
    async render(service, start) {
      await act(async () => {
        const app = React.createElement(App, {service, start});
        root.render(strict ? React.createElement(React.StrictMode, null, app) : app);
      });
    },
    async start(query) {
      let result;
      await act(async () => { result = hook.search({query}); });
      return {result};
    },
    async unmount() {
      if (closed) return;
      await act(async () => root.unmount());
      closed = true;
    },
  };
  try {
    await run(fixture);
  } finally {
    await fixture.unmount();
    dom.window.close();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

test('client replacement clears pending loading and permits a new search', async () => {
  await mounted(async view => {
    const first = client('first'), second = client('second');
    await view.render(first);
    const old = await view.start('old');
    assert.equal(view.hook.loading, true);
    await view.render(second);
    assert.equal(view.hook.loading, false);
    assert.equal(view.hook.data, null);
    assert.equal(view.hook.error, null);
    assert.equal(first.pending[0].signal.aborted, true);
    const current = await view.start('current');
    assert.equal(view.hook.loading, true);
    await act(async () => { first.pending[0].resolve(response('old')); await old.result; });
    assert.equal(view.hook.loading, true);
    assert.equal(view.hook.data, null);
    await act(async () => { second.pending[0].resolve(response('current')); await current.result; });
    assert.equal(view.hook.loading, false);
    assert.equal(view.hook.data.query, 'current');
  });
});

test('client replacement hides prior data and errors on every render of the new client', async () => {
  await mounted(async view => {
    const first = client('first'), second = client('second');
    await view.render(first);
    const old = await view.start('old data');
    await act(async () => { first.pending[0].resolve(response('old data')); await old.result; });
    let failure;
    await act(async () => { failure = view.hook.search({query: 'old failure'}).catch(error => error); });
    await act(async () => { first.pending[1].reject(new Error('old failure')); await failure; });
    assert.equal(view.hook.data.query, 'old data');
    assert.equal(view.hook.error.message, 'old failure');
    await view.render(second);
    const newRenders = view.history.filter(entry => entry.service === second);
    assert.ok(newRenders.length > 0);
    assert.ok(newRenders.every(entry => entry.data === null && entry.error === null && entry.loading === false));
  });
});

test('late rejection from the old client cannot change new client data error or loading', async () => {
  await mounted(async view => {
    const first = client('first'), second = client('second');
    await view.render(first);
    let old;
    await act(async () => { old = view.hook.search({query: 'old'}).catch(error => error); });
    await view.render(second);
    const current = await view.start('current');
    await act(async () => { first.pending[0].reject(new Error('retired client')); await old; });
    assert.equal(view.hook.loading, true);
    assert.equal(view.hook.error, null);
    assert.equal(view.hook.data, null);
    await act(async () => { second.pending[0].resolve(response('current')); await current.result; });
    assert.equal(view.hook.data.query, 'current');
    assert.equal(view.hook.error, null);
  });
});

test('a retained old cancel callback cannot stop the new client request', async () => {
  await mounted(async view => {
    const first = client('first'), second = client('second');
    await view.render(first);
    const oldCancel = view.hook.cancel;
    await view.render(second);
    const current = await view.start('current');
    await act(async () => oldCancel());
    assert.equal(second.pending[0].signal.aborted, false);
    assert.equal(view.hook.loading, true);
    await act(async () => { second.pending[0].resolve(response('current')); await current.result; });
    assert.equal(view.hook.data.query, 'current');
  });
});

test('new client work started in a child layout effect survives old passive cleanup', async () => {
  await mounted(async view => {
    const first = client('first'), second = client('second');
    await view.render(first);
    const old = await view.start('old');
    let current;
    const start = api => { current = api.search({query: 'layout current'}); };
    await view.render(second, start);
    assert.equal(first.pending[0].signal.aborted, true);
    assert.equal(second.pending.length, 1);
    assert.equal(second.pending[0].signal.aborted, false);
    assert.equal(view.hook.loading, true);
    await act(async () => { first.pending[0].resolve(response('old')); await old.result; });
    assert.equal(view.hook.loading, true);
    await act(async () => { second.pending[0].resolve(response('layout current')); await current; });
    assert.equal(view.hook.data.query, 'layout current');
    assert.equal(view.hook.loading, false);
  });
});

test('StrictMode replay and unmount abort only their own pending requests', async () => {
  await mounted(async view => {
    const service = client('strict');
    const results = [];
    const start = api => { results.push(api.search({query: `strict-${results.length}`})); };
    await view.render(service, start);
    assert.equal(service.pending.length, 2);
    assert.equal(service.pending[0].signal.aborted, true);
    assert.equal(service.pending[1].signal.aborted, false);
    assert.equal(view.hook.loading, true);
    await act(async () => { service.pending[0].resolve(response('stale strict')); await results[0]; });
    assert.equal(view.hook.loading, true);
    assert.equal(view.hook.data, null);
    await view.unmount();
    assert.equal(service.pending[1].signal.aborted, true);
    await act(async () => { service.pending[1].resolve(response('after unmount')); await results[1]; });
    assert.equal(document.getElementById('root').textContent, '');
  }, {strict: true});
});

test('same client keeps settled data while only the newest overlapping search can publish', async () => {
  await mounted(async view => {
    const service = client('same');
    await view.render(service);
    const seed = await view.start('seed');
    await act(async () => { service.pending[0].resolve(response('seed')); await seed.result; });
    const older = await view.start('older');
    assert.equal(view.hook.data.query, 'seed');
    const newer = await view.start('newer');
    assert.equal(service.pending[1].signal.aborted, true);
    await act(async () => { service.pending[1].resolve(response('older')); await older.result; });
    assert.equal(view.hook.data.query, 'seed');
    assert.equal(view.hook.loading, true);
    await act(async () => { service.pending[2].resolve(response('newer')); await newer.result; });
    assert.equal(view.hook.data.query, 'newer');
    assert.equal(view.hook.loading, false);
  });
});

test('explicit cancellation preserves settled data rejects stale state and permits retry', async () => {
  await mounted(async view => {
    const service = client('cancel');
    await view.render(service);
    const seed = await view.start('seed');
    await act(async () => { service.pending[0].resolve(response('seed')); await seed.result; });
    const old = await view.start('cancelled');
    await act(async () => view.hook.cancel());
    assert.equal(service.pending[1].signal.aborted, true);
    assert.equal(view.hook.loading, false);
    assert.equal(view.hook.data.query, 'seed');
    await act(async () => { service.pending[1].resolve(response('cancelled')); await old.result; });
    assert.equal(view.hook.data.query, 'seed');
    const current = await view.start('retry');
    await act(async () => { service.pending[2].resolve(response('retry')); await current.result; });
    assert.equal(view.hook.data.query, 'retry');
    assert.equal(view.hook.loading, false);
  });
});

test('synchronous abort reentry keeps the newest search and prevents superseded dispatch', async () => {
  await mounted(async view => {
    const service = client('reentrant');
    await view.render(service);
    const first = await view.start('first');
    let newest;
    service.pending[0].signal.addEventListener('abort', () => {
      newest = view.hook.search({query: 'newest'});
    }, {once: true});
    let middle;
    await act(async () => { middle = view.hook.search({query: 'middle'}).catch(error => error); });
    assert.equal((await middle).name, 'AbortError');
    assert.deepEqual(service.pending.map(call => call.request.query), ['first', 'newest']);
    assert.equal(service.pending[1].signal.aborted, false);
    assert.equal(view.hook.loading, true);
    await act(async () => { service.pending[0].resolve(response('first')); await first.result; });
    assert.equal(view.hook.loading, true);
    await act(async () => { service.pending[1].resolve(response('newest')); await newest; });
    assert.equal(view.hook.data.query, 'newest');
    assert.equal(view.hook.loading, false);
  });
});

test('synchronous abort reentry during cancel cannot clear a newly started search', async () => {
  await mounted(async view => {
    const service = client('cancel reentry');
    await view.render(service);
    const first = await view.start('first');
    let next;
    service.pending[0].signal.addEventListener('abort', () => {
      next = view.hook.search({query: 'next'});
    }, {once: true});
    await act(async () => view.hook.cancel());
    assert.deepEqual(service.pending.map(call => call.request.query), ['first', 'next']);
    assert.equal(service.pending[1].signal.aborted, false);
    assert.equal(view.hook.loading, true);
    await act(async () => { service.pending[0].resolve(response('first')); await first.result; });
    assert.equal(view.hook.loading, true);
    await act(async () => { service.pending[1].resolve(response('next')); await next; });
    assert.equal(view.hook.data.query, 'next');
    assert.equal(view.hook.loading, false);
  });
});
