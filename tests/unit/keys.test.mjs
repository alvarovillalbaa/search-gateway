// T2: keys are generated solely in temporary test directories and removed after use.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile, symlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createApiKey, keyStoreAuthenticator} from '../../packages/search-gateway/dist/server.js';

test('CLI creates one-time gateway key, lists only metadata, and revokes it', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'search-gateway-cli-')); t.after(() => rm(dir, {recursive: true, force: true}));
  const store = join(dir, 'keys.json'); const cli = new URL('../../packages/search-gateway/dist/cli.js', import.meta.url).pathname;
  const run = args => {const result = spawnSync(process.execPath, [cli, ...args, '--store', store], {encoding: 'utf8'}); assert.equal(result.status, 0, result.stderr); return result.stdout;};
  const key = JSON.parse(run(['key', 'create', '--providers', 'exa', '--rpm', '3']));
  assert.ok(key.apiKey.startsWith('sgk_')); assert.deepEqual(key.providers, ['exa']); assert.equal(key.requestsPerMinute, 3);
  const metadata = run(['key', 'list']); assert.ok(!metadata.includes(key.apiKey)); assert.ok(!metadata.includes('hash'));
  assert.equal((await keyStoreAuthenticator(store)(key.apiKey)).id, key.id);
  run(['key', 'revoke', key.id]); assert.equal(await keyStoreAuthenticator(store)(key.apiKey), undefined);
  assert.ok(!(await readFile(store, 'utf8')).includes(key.apiKey));
});
test('key store refuses symlink destinations and an active writer lock', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'search-gateway-keys-')); t.after(() => rm(dir, {recursive: true, force: true}));
  const store = join(dir, 'keys.json'); const target = join(dir, 'target.json'); await writeFile(target, '{}'); await symlink(target, store);
  await assert.rejects(createApiKey(store), {code: 'unsafe_key_store'});
  const locked = join(dir, 'locked.json'); await writeFile(locked + '.lock', '');
  await assert.rejects(createApiKey(locked), {code: 'key_store_busy'});
  assert.equal(await readFile(target, 'utf8'), '{}');
});
