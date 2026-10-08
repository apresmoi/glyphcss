export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="maps-layer-info-row"
      title={`${label} — provenance baked into the tile pyramid at build time, not a live control`}
    >
      <span>{label}</span>
      <span className="maps-layer-info-value">{value}</span>
    </div>
  );
}
