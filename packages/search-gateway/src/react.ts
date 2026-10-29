"use client";
import {useCallback, useEffect, useMemo, useState} from "react";
import type {SearchRequest, SearchResponse, SearchService} from "./types.js";

interface SearchState {
  data: SearchResponse | null;
  error: Error | null;
  loading: boolean;
}

/** Pass a same-origin application proxy client; never ship a gateway or upstream secret to the browser. */
export function useSearchGateway(client: SearchService) {
  const owner = useMemo(() => ({
    generation: 0,
    controller: null as AbortController | null,
    active: false,
    state: {data: null, error: null, loading: false} as SearchState,
  }), [client]);
  const [snapshot, setSnapshot] = useState(() => ({owner, state: owner.state}));
  const publish = useCallback(() => {
    if (owner.active) setSnapshot({owner, state: owner.state});
  }, [owner]);
  useEffect(() => {
    owner.active = true;
    // A child layout effect may already have started this client's request.
    publish();
    return () => {
      owner.active = false;
      owner.generation++;
      const previous = owner.controller;
      owner.controller = null;
      owner.state = {...owner.state, loading: false};
      previous?.abort();
    };
  }, [owner, publish]);
  const cancel = useCallback(() => {
    owner.generation++;
    const previous = owner.controller;
    owner.controller = null;
    owner.state = {...owner.state, loading: false};
    publish();
    previous?.abort();
  }, [owner, publish]);
  const search = useCallback(async (request: SearchRequest) => {
    const current = ++owner.generation;
    const previous = owner.controller;
    const next = new AbortController();
    owner.controller = next;
    owner.state = {...owner.state, loading: true, error: null};
    publish();
    previous?.abort();
    try {
      // Aborting the prior transport can synchronously start a newer request.
      if (owner.generation !== current) {
        next.abort();
        throw new DOMException("Search cancelled", "AbortError");
      }
      const result = await client.search(request, {signal: next.signal});
      if (owner.generation === current) {
        owner.state = {...owner.state, data: result};
        publish();
      }
      return result;
    } catch (e) {
      const failure = e instanceof Error ? e : new Error("Search failed");
      if (owner.generation === current) {
        owner.state = {...owner.state, error: failure};
        publish();
      }
      throw failure;
    } finally {
      if (owner.generation === current) {
        owner.controller = null;
        owner.state = {...owner.state, loading: false};
        publish();
      }
    }
  }, [client, owner, publish]);
  const state = snapshot.owner === owner ? snapshot.state : {data: null, error: null, loading: false};
  return {...state, search, cancel};
}
