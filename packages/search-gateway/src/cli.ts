#!/usr/bin/env node
import {parseArgs} from "node:util";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {createInterface} from "node:readline";
import {createSearchGateway, keysFromEnv, PROVIDERS, type GatewayOptions} from "./core.js";
import {SearchGateway, createSearchTool, createContentsTool} from "./index.js";
import {createApiKey, listApiKeys, revokeApiKey, keyStoreAuthenticator, createGatewayServer} from "./server.js";
import {GatewayError} from "./validation.js";
import type {ProviderId, SearchService} from "./types.js";

const help = `Search Gateway 0.1.0

  search-gateway key create [--name app] [--providers exa,tavily] [--rpm 60]
  search-gateway key list
  search-gateway key revoke <id>
  search-gateway serve [--host 127.0.0.1] [--port 8787] [--config gateway.json]
  search-gateway search "query" [--providers exa,tavily] [--mode parallel] [--content text]
  search-gateway contents <url> [<url>...]
  search-gateway providers
  search-gateway mcp

All commands: --store .search-gateway/keys.json
serve: --allow-request-keys, --origins https://your-app.example
client commands: --base-url <gateway> (uses SEARCH_GATEWAY_API_KEY)
Without --base-url, search/contents/mcp call providers directly using environment keys.
Keys are shown only when created. Provider credentials are read from environment variables.
`;
function providerList(input?: string): ProviderId[] | undefined {
  if (input === undefined) return;
  const ids = input.split(",");
  if (ids.some(id => !PROVIDERS.includes(id as ProviderId))) throw new GatewayError("invalid_providers", "Unknown provider name");
  return ids as ProviderId[];
}
async function mcp(service: SearchService) {
  const tools = [createSearchTool(service), createContentsTool(service)];
  let negotiated = false; let initialized = false;
  const lines = createInterface({input: process.stdin, crlfDelay: Infinity});
  const send = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
  for await (const line of lines) {
    if (!line.trim()) continue;
    let request: any;
    try {
      if (line.length > 65_536) throw new Error("too large");
      request = JSON.parse(line);
      if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") throw new Error("invalid request");
      if (request.id === undefined) { if (request.method === "notifications/initialized" && negotiated) initialized = true; continue; }
      if (request.method !== "initialize" && request.method !== "ping" && !initialized) { send({jsonrpc: "2.0", id: request.id, error: {code: -32002, message: "Server not initialized"}}); continue; }
      let result: unknown;
      switch (request.method) {
        case "initialize": {
          negotiated = true;
          const versions = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
          result = {protocolVersion: versions.includes(request.params?.protocolVersion) ? request.params.protocolVersion : versions[0], capabilities: {tools: {}}, serverInfo: {name: "search-gateway", version: "0.1.0"}}; break;
        }
        case "ping": result = {}; break;
        case "tools/list": result = {tools: tools.map(t => ({name: t.name, description: t.description, inputSchema: t.parameters}))}; break;
        case "tools/call": {
          const tool = tools.find(t => t.name === request.params?.name);
          if (!tool) { send({jsonrpc: "2.0", id: request.id, error: {code: -32602, message: "Unknown tool"}}); continue; }
          try { const data = await tool.execute(request.params?.arguments ?? {} as any); result = {content: [{type: "text", text: JSON.stringify(data)}]}; }
          catch (e) { result = {isError: true, content: [{type: "text", text: e instanceof GatewayError ? e.code : "tool_failed"}]}; }
          break;
        }
        default: send({jsonrpc: "2.0", id: request.id, error: {code: -32601, message: "Method not found"}}); continue;
      }
      send({jsonrpc: "2.0", id: request.id, result});
    } catch { send({jsonrpc: "2.0", id: request?.id ?? null, error: {code: -32700, message: "Invalid JSON-RPC request"}}); }
  }
}
async function main() {
  const {positionals: args, values: flags} = parseArgs({allowPositionals: true, options: {help: {type: "boolean", short: "h"}, store: {type: "string"}, name: {type: "string"}, providers: {type: "string"}, rpm: {type: "string"}, host: {type: "string"}, port: {type: "string"}, config: {type: "string"}, mode: {type: "string"}, content: {type: "string"}, limit: {type: "string"}, origins: {type: "string"}, "allow-request-keys": {type: "boolean"}, "base-url": {type: "string"}}});
  if (flags.help || !args[0]) { process.stdout.write(help); return; }
  const store = resolve(flags.store ?? ".search-gateway/keys.json");
  const providers = providerList(flags.providers);
  if (args[0] === "key") {
    if (args[1] === "create") process.stdout.write(`${JSON.stringify(await createApiKey(store, {name: flags.name, providers, requestsPerMinute: flags.rpm ? Number(flags.rpm) : undefined}), null, 2)}\n`);
    else if (args[1] === "list") process.stdout.write(`${JSON.stringify(await listApiKeys(store), null, 2)}\n`);
    else if (args[1] === "revoke" && args[2]) { await revokeApiKey(store, args[2]); process.stdout.write("Key revoked\n"); }
    else throw new GatewayError("usage", "Use key create, key list, or key revoke <id>");
    return;
  }
  const fileConfig: GatewayOptions = flags.config ? JSON.parse(await readFile(resolve(flags.config), "utf8")) : {};
  if ((fileConfig as any).providerKeys || (fileConfig.router && (fileConfig.router.jevApiKey || fileConfig.router.openaiApiKey))) throw new GatewayError("unsafe_config", "Keep credentials in environment variables, outside JSON configuration");
  const gateway = createSearchGateway({...fileConfig, enabledProviders: providers ?? fileConfig.enabledProviders, providerKeys: keysFromEnv(), router: {...fileConfig.router, jevApiKey: process.env.TYPESAFE_API_KEY, openaiApiKey: process.env.OPENAI_API_KEY}});
  const baseUrl = flags["base-url"] ?? process.env.SEARCH_GATEWAY_URL;
  const service = baseUrl ? new SearchGateway({baseUrl, apiKey: process.env.SEARCH_GATEWAY_API_KEY, defaults: providers ? {providers} : undefined}) : gateway;
  switch (args[0]) {
    case "serve": {
      if (!(await listApiKeys(store)).some(k => !k.revokedAt)) throw new GatewayError("no_gateway_keys", "Create a gateway key with key create before starting");
      const port = Number(flags.port ?? 8787);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new GatewayError("invalid_port", "Invalid port");
      const server = createGatewayServer({gateway, authenticate: keyStoreAuthenticator(store), allowRequestKeys: flags["allow-request-keys"], allowedOrigins: flags.origins?.split(",")});
      server.requestTimeout = 30_000; server.headersTimeout = 10_000;
      server.listen(port, flags.host ?? "127.0.0.1", () => process.stderr.write(`Search Gateway listening on ${flags.host ?? "127.0.0.1"}:${(server.address() as any).port}\n`));
      server.on("error", () => { process.stderr.write("Unable to start gateway listener\n"); process.exitCode = 1; });
      const shutdown = () => { server.close(); server.closeIdleConnections(); };
      process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
      break;
    }
    case "search": process.stdout.write(`${JSON.stringify(await service.search({query: args.slice(1).join(" "), ...(providers ? {providers} : {}), ...(flags.mode ? {mode: flags.mode as any} : {}), ...(flags.content ? {content: flags.content as any} : {}), ...(flags.limit ? {limit: Number(flags.limit)} : {})}), null, 2)}\n`); break;
    case "contents": process.stdout.write(`${JSON.stringify(await service.contents({urls: args.slice(1)}), null, 2)}\n`); break;
    case "providers": process.stdout.write(`${JSON.stringify(await (baseUrl ? (service as SearchGateway).providers() : gateway.providers()), null, 2)}\n`); break;
    case "mcp": await mcp(service); break;
    default: throw new GatewayError("usage", "Unknown command. Run search-gateway --help");
  }
}
main().catch(e => { process.stderr.write(`${e instanceof GatewayError ? `${e.code}: ${e.message}` : "Command failed; check configuration and file permissions"}\n`); process.exitCode = 1; });
