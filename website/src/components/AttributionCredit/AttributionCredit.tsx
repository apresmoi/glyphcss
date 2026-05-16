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
}): JSX.Element {
  if (!attribution) {
    return <p className="model-credit">Source: Unknown</p>;
  }

  const trisText =
    typeof attribution.tris === "number" ? ` · ${attribution.tris.toLocaleString()} tris` : "";

  return (
    <p className="model-credit">
      Source:{" "}
      {attribution.sourceUrl ? (
        <a href={attribution.sourceUrl} target="_blank" rel="noreferrer">
          {attribution.creator}
        </a>
      ) : (
        attribution.creator
      )}
      {attribution.license ? ` · ${attribution.license}` : ""}
      {trisText}
    </p>
  );
}
