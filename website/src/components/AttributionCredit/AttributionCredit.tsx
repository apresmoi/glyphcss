export interface ModelAttribution {
  creator: string;
  license?: string;
  sourceUrl?: string;
  tris?: number;
}

export function AttributionCredit({
  attribution,
}: {
  attribution?: ModelAttribution;
}) {
  if (!attribution) {
    return (
      <p className="model-credit">
        <span className="model-credit__seg">[ source: Unknown ]</span>
      </p>
    );
  }

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
    <p className="model-credit">
      <span className="model-credit__seg">[ source: {creatorNode} ]</span>
      {attribution.license && (
        <>
          <span className="model-credit__sep">──</span>
          <span className="model-credit__seg">[ license: {attribution.license} ]</span>
        </>
      )}
      {trisText && (
        <>
          <span className="model-credit__sep">──</span>
          <span className="model-credit__seg model-credit__tris">[ {trisText} ]</span>
        </>
      )}
    </p>
  );
}
