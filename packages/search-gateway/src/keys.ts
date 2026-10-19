import {createHash, randomBytes, timingSafeEqual} from "node:crypto";
import {mkdir, open, readFile, rename, unlink, lstat} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {GatewayError} from "./validation.js";
import {PROVIDERS, type ProviderId} from "./types.js";

export interface KeyPolicy { id: string; name: string; providers?: ProviderId[]; requestsPerMinute: number }
export interface KeyRecord extends KeyPolicy { hash: string; createdAt: string; revokedAt?: string }
type Store = {version: 1; keys: KeyRecord[]};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
async function safePath(path: string) {
  for (const p of [dirname(path), path]) {
    try { const stat = await lstat(p); if (stat.isSymbolicLink()) throw new GatewayError("unsafe_key_store", "Key store cannot be a symlink", 500); }
    catch (e: any) { if (e.code !== "ENOENT") throw e; }
  }
}
async function readStore(path: string): Promise<Store> {
  await safePath(path);
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (value.version !== 1 || !Array.isArray(value.keys)) throw new Error("Invalid store");
    return value;
  } catch (e: any) { if (e.code === "ENOENT") return {version: 1, keys: []}; throw new GatewayError("invalid_key_store", "Cannot read key store", 500); }
}
async function mutate(path: string, update: (store: Store) => void) {
  path = resolve(path); await safePath(path); await mkdir(dirname(path), {recursive: true, mode: 0o700});
  const lockPath = `${path}.lock`; let lock;
  try { lock = await open(lockPath, "wx", 0o600); } catch { throw new GatewayError("key_store_busy", "Key store is locked; retry after the other CLI process exits", 409); }
  const temp = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    const store = await readStore(path); update(store);
    const file = await open(temp, "wx", 0o600);
    try { await file.writeFile(`${JSON.stringify(store, null, 2)}\n`); await file.sync(); } finally { await file.close(); }
    await rename(temp, path);
  } finally { await unlink(temp).catch(() => {}); await lock.close(); await unlink(lockPath); }
}
/** Provision locally on the gateway host. Plaintext is returned once; only its hash is stored. */
export async function createApiKey(path: string, options: {name?: string; providers?: ProviderId[]; requestsPerMinute?: number} = {}) {
  const rpm = options.requestsPerMinute ?? 60;
  if (!Number.isInteger(rpm) || rpm < 1 || rpm > 10_000) throw new GatewayError("invalid_key_policy", "requestsPerMinute must be 1 to 10000");
  if (options.providers && (!options.providers.length || options.providers.some(p => !PROVIDERS.includes(p)))) throw new GatewayError("invalid_key_policy", "Invalid providers");
  if (options.name !== undefined && (typeof options.name !== "string" || options.name.length > 100)) throw new GatewayError("invalid_key_policy", "name must have at most 100 characters");
  const id = randomBytes(8).toString("hex"); const apiKey = `sgk_${id}.${randomBytes(32).toString("base64url")}`;
  const metadata: KeyRecord = {id, name: options.name ?? "default", hash: hash(apiKey), createdAt: new Date().toISOString(), requestsPerMinute: rpm, ...(options.providers ? {providers: options.providers} : {})};
  await mutate(path, store => { store.keys.push(metadata); });
  const {hash: _, ...key} = metadata; return {apiKey, ...key};
}
export async function listApiKeys(path: string) { return (await readStore(path)).keys.map(({hash: _, ...key}) => key); }
export async function revokeApiKey(path: string, id: string) {
  await mutate(path, store => { const key = store.keys.find(k => k.id === id); if (!key) throw new GatewayError("key_not_found", "Key ID not found", 404); key.revokedAt = new Date().toISOString(); });
}
export function keyStoreAuthenticator(path: string) {
  return async (apiKey: string): Promise<KeyPolicy | undefined> => {
    if (!/^sgk_[a-f0-9]{16}\.[a-zA-Z0-9_-]{43}$/.test(apiKey)) return;
    const digest = Buffer.from(hash(apiKey), "hex");
    for (const key of (await readStore(path)).keys) {
      if (key.revokedAt) continue;
      const stored = Buffer.from(key.hash, "hex");
      if (stored.length === digest.length && timingSafeEqual(stored, digest)) return {id: key.id, name: key.name, providers: key.providers, requestsPerMinute: key.requestsPerMinute};
    }
  };
}
