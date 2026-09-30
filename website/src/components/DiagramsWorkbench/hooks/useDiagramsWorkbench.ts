import { useEffect, useState } from "react";
import {
  type GlyphDiagramsWorkbenchState,
  createGlyphDiagramsWorkbenchState,
} from "../../../features/diagrams/model/diagramsWorkbenchState";
import { DIAGRAMS_URL_PARAM, decodeDiagramsUrlState } from "../../../features/diagrams/services/diagramsUrlState";
import { readUrlParam } from "../../../services/url-state/history";

/**
 * Gates the FIRST render on the `?d=` URL param (AGENTS.md's "## Diagrams"
 * — "URL state"), same split as ChartsWorkbench.tsx's own gate: the common
 * no-param case resolves the default state synchronously (no gate at all),
 * and only a page actually carrying a `?d=` link waits — briefly, and
 * without ever showing the default graph first — for the async decode
 * (deflate is inherently async; see jsonUrlState.ts's doc) to settle.
 * `initialState` (DiagramsWorkbench.test.tsx's synchronous mount) bypasses
 * the URL entirely, exactly as before this feature existed.
 */
export function useDiagramsWorkbench({ initialState }: { initialState?: GlyphDiagramsWorkbenchState } = {}) {
  const [resolved, setResolved] = useState<GlyphDiagramsWorkbenchState | null>(() => {
    if (initialState) return initialState;
    return readUrlParam(DIAGRAMS_URL_PARAM) ? null : createGlyphDiagramsWorkbenchState();
  });

  useEffect(() => {
    if (initialState || resolved) return;
    let cancelled = false;
    void decodeDiagramsUrlState(readUrlParam(DIAGRAMS_URL_PARAM)).then((decoded) => {
      if (!cancelled) setResolved(decoded ?? createGlyphDiagramsWorkbenchState());
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!resolved) return null;

  // Packet D5 — a decoded link naming an un-edited remote graph
  // (`graphSource.omitted`, `diagramsUrlState.ts`'s own doc) carries no
  // node/edge data at all; this is the ONE thing the outer wrapper computes
  // from `resolved` before handing off, mirroring `ChartsWorkbench.tsx`'s
  // own `initialRemoteRef` split.
  const initialRemoteGraph =
    resolved.graphSource?.kind === "remote" && resolved.graphSource.omitted
      ? {
          ref: resolved.graphSource.ref,
          rowIdx: resolved.graphSource.rowIdx,
          title: resolved.graphSource.title,
          description: resolved.graphSource.description,
          licence: resolved.graphSource.source.licence,
        }
      : undefined;
  return { resolved, initialRemoteGraph };
}
