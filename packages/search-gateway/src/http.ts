import {GatewayError} from "./validation.js";

export class UpstreamError extends GatewayError {
  constructor(public provider: string, code: string, status: number, public retryable: boolean) { super(code, `${provider}: ${code}`, status); }
}
export async function readJson(response: Response, maxBytes = 8_000_000): Promise<any> {
  const reader = response.body?.getReader();
  if (!reader) throw new GatewayError("invalid_response", "Empty response", 502);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new GatewayError("response_too_large", "Response exceeds size limit", 502);
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new GatewayError("invalid_response", "Response is not JSON", 502); }
}
export type Fetch = typeof globalThis.fetch;
export async function upstream(fetcher: Fetch, provider: string, url: string, key: string, body: unknown, signal: AbortSignal, authHeader: string | null = "Authorization", method = "POST") {
  const headers: Record<string, string> = {"Accept": "application/json"};
  if (authHeader) headers[authHeader] = authHeader === "Authorization" ? `Bearer ${key}` : key;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let response: Response;
  try { response = await fetcher(url, {method, headers, ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal, redirect: "error"}); }
  catch { throw new UpstreamError(provider, signal.aborted ? "timeout_or_cancelled" : "network_error", 502, true); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new UpstreamError(provider, `http_${response.status}`, 502, response.status === 429 || response.status >= 500);
  }
  return readJson(response);
}
