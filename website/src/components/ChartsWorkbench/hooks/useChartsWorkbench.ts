import { useEffect, useState } from "react";
import { type ChartsWorkbenchState } from "../../../features/charts/model/chartsSpec";
import {
  CHARTS_URL_PARAM,
  chartsUrlStateResolveDataset,
  decodeChartsUrlState,
} from "../../../features/charts/services/chartsUrlState";
import { readUrlParam } from "../../../services/url-state/history";
import { createRandomChartsWorkbenchState } from "../initialState";

/**
 * Gates the FIRST render on the `?c=` URL param (AGENTS.md's "## Charts" —
 * "URL state") so a shared link never flashes the default chart before its
 * own state lands. Decoding a `?c=` param is inherently async (deflate —
 * see jsonUrlState.ts's doc), so this can't be a plain `useReducer` lazy
 * initializer the way `initialState` (tests, `renderToStaticMarkup`) is —
 * but the by-far-common case (no param at all) needs no async gate: the
 * default state IS correct immediately, so only a page actually carrying a
 * `?c=` link ever renders the brief `null` gap below.
 *
 * `initialState` (used by chartsWorkbenchState.test.tsx's
 * `renderToStaticMarkup` and ChartsWorkbench.test.tsx's synchronous mount)
 * bypasses the URL entirely, exactly as before this feature existed.
 */
export function useChartsWorkbench({ initialState }: { initialState?: ChartsWorkbenchState } = {}) {
  const [resolved, setResolved] = useState<ChartsWorkbenchState | null>(() => {
    if (initialState) return initialState;
    return readUrlParam(CHARTS_URL_PARAM) ? null : createRandomChartsWorkbenchState();
  });

  const [notice, setNotice] = useState<string | undefined>(undefined);

  // Set only when the decoded link named a REMOTE dataset (`data.source.kind
  // === "remote"`) — its rows are never in the link (`chartsUrlState.ts`'s
  // "URL state" doc), so the page mounts on the decoded shell (mark data
  // still blank) and `ChartsWorkbenchInner`'s own mount effect re-fetches
  // this ref immediately, exactly like a fresh search-box selection would.
  const [remoteRef, setRemoteRef] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (initialState || resolved) return;
    let cancelled = false;
    void decodeChartsUrlState(readUrlParam(CHARTS_URL_PARAM)).then((decoded) => {
      if (cancelled) return;
      if (!decoded) {
        setResolved(createRandomChartsWorkbenchState());
        return;
      }
      // P2-3 (review fix, REVIEW-showcase-opus.md): an unresolvable stock
      // dataset id degrades to a random vendored dataset with a notice,
      // the same graceful fallback a CORRUPT envelope already gets —
      // never a hard `empty-data` render. A remote source is reported the
      // same way but resolved via `remoteRef` below, not a fallback.
      const { state, notice: fallbackNotice, remoteRef: ref } = chartsUrlStateResolveDataset(decoded);
      setResolved(state);
      setNotice(fallbackNotice);
      setRemoteRef(ref);
    });
    return () => {
      cancelled = true;
    };
    // Only ever runs once: `resolved` starts non-null (no gate needed) or
    // this effect's own setResolved call makes it non-null on next render,
    // and the guard above then short-circuits for good.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!resolved) return null;
  return { resolved, notice, remoteRef };
}
