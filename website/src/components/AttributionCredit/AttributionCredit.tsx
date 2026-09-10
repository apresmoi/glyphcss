export interface ModelAttribution {
  creator: string;
  license?: string;
  sourceUrl?: string;
  tris?: number;
  /** Free-form date/version segment — e.g. `"2009"`, `"v5.1.1"`. */
  date?: string;
}

function AttributionSegments({ attribution }: { attribution: ModelAttribution }) {
  const trisText =
    typeof attribution.tris === "number"
      ? attribution.tris.toLocaleString() + " tris"
      : null;

  const creatorNode = attribution.sourceUrl ? (
    <a href={attribution.sourceUrl} target="_blank" rel="noreferrer">
      {attribution.creator}
    </a>
  ) : (
    attribution.creator
  );

  return (
    <>
      <span className="model-credit__seg">[ source: {creatorNode} ]</span>
      {attribution.license && (
        <>
          <span className="model-credit__sep">──</span>
          <span className="model-credit__seg">[ license: {attribution.license} ]</span>
        </>
      )}
      {attribution.date && (
        <>
          <span className="model-credit__sep">──</span>
          <span className="model-credit__seg">[ {attribution.date} ]</span>
        </>
      )}
      {trisText && (
        <>
          <span className="model-credit__sep">──</span>
          <span className="model-credit__seg model-credit__tris">[ {trisText} ]</span>
        </>
      )}
    </>
  );
}

/**
 * `attributions` (plural) is the general form — one bracketed cluster per
 * mounted data source, aggregated by the caller (e.g. `createGlyphMap`'s
 * `getAttributions()`, MAPS.md's "derived from mounted layers" requirement)
 * rather than hardcoded. `attribution` (singular) is a convenience for the
 * single-source case (`ModelsSidebar`-style usage); passing both renders
 * `attribution` first, then `attributions`. With neither, falls back to an
 * "Unknown" source.
 */
export function AttributionCredit({
  attribution,
  attributions,
}: {
  attribution?: ModelAttribution;
  attributions?: readonly ModelAttribution[];
}) {
  const all = [...(attribution ? [attribution] : []), ...(attributions ?? [])];

  if (all.length === 0) {
    return (
      <p className="model-credit">
        <span className="model-credit__seg">[ source: Unknown ]</span>
      </p>
    );
  }

  return (
    <p className="model-credit">
      {all.map((a, i) => (
        <span key={`${a.creator}-${i}`} className="model-credit__source">
          {i > 0 && <span className="model-credit__sep model-credit__sep--source"> </span>}
          <AttributionSegments attribution={a} />
        </span>
      ))}
    </p>
  );
}
