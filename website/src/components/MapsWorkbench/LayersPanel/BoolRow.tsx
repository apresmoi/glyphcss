/**
 * A boolean row — same `[ ]`/`[x]` idiom as `LayerCard`'s own visibility
 * checkbox (`.layer-group-check`, itself a reproduction of the Dock's
 * `.controller.boolean` checkbox), landed in the card body's shared 3-column
 * grid rather than hand-rolled: the name in column 1, the checkbox spanning
 * the widget/value columns (2/4) like a `<select>` row with no separate
 * readout of its own.
 */
export function BoolRow({
  label,
  value,
  onChange,
  title,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  title: string;
}) {
  return (
    <label className="maps-layer-bool-row" title={title}>
      <span>{label}</span>
      <span className="layer-group-check maps-layer-bool-check">
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      </span>
    </label>
  );
}
