"use client";
import {useCallback, useEffect, useRef, useState} from "react";
import type {SearchRequest, SearchResponse, SearchService} from "./types.js";

/** Pass a same-origin application proxy client; never ship a gateway or upstream secret to the browser. */
export function useSearchGateway(client: SearchService) {
  const [data, setData] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0); const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { generation.current++; controller.current?.abort(); }, [client]);
  const cancel = useCallback(() => { generation.current++; controller.current?.abort(); setLoading(false); }, []);
  const search = useCallback(async (request: SearchRequest) => {
    controller.current?.abort(); const current = ++generation.current;
    const next = new AbortController(); controller.current = next;
    setLoading(true); setError(null);
    try { const result = await client.search(request, {signal: next.signal}); if (generation.current === current) setData(result); return result; }
    catch (e) { const failure = e instanceof Error ? e : new Error("Search failed"); if (generation.current === current) setError(failure); throw failure; }
    finally { if (generation.current === current) setLoading(false); }
  }, [client]);
  return {data, error, loading, search, cancel};
}
