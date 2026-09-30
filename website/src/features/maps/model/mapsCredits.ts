/**
 * The map's CREDIT LINE — what has to be on screen, and what may sit one tap
 * behind it.
 *
 * ## The problem
 *
 * `createGlyphMap`'s `getAttributions()` is derived from the mounted layers,
 * so the data was always right; the PRESENTATION was not. `AttributionCredit`
 * renders one `[ source: X ]──[ license: Y ]──[ date ]` cluster per source,
 * and with the OSM card mounted this page has five of them. Measured on the
 * built page:
 *
 * - 1440x900: 549x52 px, two wrapped rows, overlapping the export bar.
 * - 390x844: 195x114 px — 13.5% of the viewport, 7.6% of the whole map
 *   surface, wrapped into six fragments with orphaned separators, and sitting
 *   straight through the mobile tab bar. (`.maps-attribution` is `left: 50%`
 *   plus `translateX(-50%)`, so its shrink-to-fit width is capped at half the
 *   viewport however much room its `max-width` allows.)
 *
 * And it costs MAP: the grid's cell count comes from the element's size, so
 * every row of credits is rows of terrain that were never rendered.
 *
 * ## What the licences actually require
 *
 * Not all five are obligations. Of the sources this page can mount:
 *
 * - **NOAA NCEI (ETOPO1)** and **Natural Earth** are PUBLIC DOMAIN. Natural
 *   Earth says so explicitly ("no permission needed"); a US federal work is
 *   uncopyrightable. Crediting them is courtesy, not a licence term.
 * - **OpenStreetMap contributors** (ODbL), **OpenMapTiles** (CC-BY 4.0) and
 *   **OpenFreeMap** (ODbL) all REQUIRE attribution.
 *
 * So the compression is principled rather than cosmetic: the always-visible
 * line names every source that legally has to be named, and the courtesy
 * credits move behind the expander — where they are still one tap away and
 * still carry their licence and their link.
 *
 * On a phone even the required names are allowed behind an affordance: OSM's
 * own attribution guidance treats a small screen as a "constrained display",
 * where a visible attribution CONTROL (the copyright mark every web map
 * ships) leading to the credit discharges the term. That is why
 * {@link mapCreditSummary} takes a `maxNames` the caller sets per breakpoint
 * instead of a fixed truncation — and why the toggle is always rendered, even
 * when nothing is hidden.
 *
 * Pure, so the rule is testable without a browser.
 */

export interface MapCreditSource {
  readonly name: string;
  readonly license?: string;
  readonly url?: string;
  readonly date?: string;
}

export interface MapCreditSummary {
  /** The names on the always-visible line, in mounted order. */
  readonly named: readonly string[];
  /** Sources NOT on that line — the number the `+N` affordance quotes. */
  readonly hiddenCount: number;
  /** Every source, deduped — what the expanded panel renders. */
  readonly sources: readonly MapCreditSource[];
  /** Whether any NAMED source carries a real licence obligation, so the line earns its copyright mark. */
  readonly copyrighted: boolean;
}

/**
 * Licences that impose no attribution term. Matched case-insensitively on the
 * strings the providers themselves put in `GlyphMapAttribution.license`
 * (`@glyphcss/maps`' `attribution.ts`), so an UNRECOGNISED licence is treated
 * as REQUIRING attribution — the safe direction to be wrong in.
 */
const NO_ATTRIBUTION_REQUIRED = [/public\s*domain/i, /^cc0\b/i, /\bcc0-1\.0\b/i, /^unlicense$/i];

export function mapCreditRequiresNotice(license: string | undefined): boolean {
  if (!license) return true;
  return !NO_ATTRIBUTION_REQUIRED.some((re) => re.test(license.trim()));
}

/** Two layers off one provider credit it twice; the reader should see it once. */
function dedupe(sources: readonly MapCreditSource[]): readonly MapCreditSource[] {
  const seen = new Set<string>();
  const out: MapCreditSource[] = [];
  for (const s of sources) {
    const key = `${s.name} ${s.license ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * @param maxNames How many names the always-visible line may carry. The
 * caller sets it per breakpoint (this page: 3 on desktop, 1 on a phone).
 * A value below 1 is raised to 1 — a credit line with no name at all is not
 * an attribution, it is a decoration.
 */
export function mapCreditSummary(
  sources: readonly MapCreditSource[],
  { maxNames }: { readonly maxNames: number },
): MapCreditSummary {
  const all = dedupe(sources);
  const limit = Math.max(1, Math.floor(maxNames));
  const required = all.filter((s) => mapCreditRequiresNotice(s.license));
  // Nothing carries an obligation (the default page: two public-domain
  // sources), so the line is pure courtesy — show the sources themselves
  // rather than an empty mark and a bare `+2`.
  const preferred = required.length > 0 ? required : all;
  const named = preferred.slice(0, limit);
  return {
    named: named.map((s) => s.name),
    hiddenCount: all.length - named.length,
    sources: all,
    copyrighted: named.some((s) => mapCreditRequiresNotice(s.license)),
  };
}

/** The always-visible line's text, without the `+N` affordance. */
export function mapCreditNoticeText(summary: MapCreditSummary): string {
  const names = summary.named.join(" · ");
  return summary.copyrighted ? `© ${names}` : names;
}
