import { useCallback, useRef, useState } from "react";

/**
 * A dock row whose slider is LOGARITHMIC — equal travel per doubling.
 *
 * Used for `scale`, a pure multiplier: on a linear 0.1..12 dial every authored
 * value in this repo sits below 3, so three quarters of the travel does nothing
 * while the interesting octaves are crushed into the first quarter. A true log
 * works here (unlike the voice `freq` dial, which needs a power taper because it
 * must reach exactly 0).
 *
 * It renders through a dock SLOT because lil-gui's slider is linear over
 * [min,max] and displays the raw proxy value — driving that controller in
 * position space would show 0..1 instead of the real number. To stay visually
 * identical to every other dock row it reproduces lil-gui's own row markup
 * (`.controller.number.hasSlider > .name + .widget > .slider > .fill`, plus the
 * text input), so the dock's stylesheet dresses it exactly like a native row.
 */
export function LogSliderRow({
  label,
  title,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  title: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}) {
  const span = Math.log(max / min);
  const clamp = (v: number): number => Math.min(max, Math.max(min, v));
  const toPos = (v: number): number => Math.log(clamp(v) / min) / span;
  const toValue = (pos: number): number => {
    const v = min * Math.exp(Math.min(1, Math.max(0, pos)) * span);
    // Finer quantization down low, where the log hands you the resolution.
    return v < 1 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10;
  };
  const track = useRef<HTMLDivElement | null>(null);
  const [text, setText] = useState<string | null>(null);

  const setFromPointer = useCallback(
    (clientX: number) => {
      const el = track.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width <= 0) return;
      onChange(toValue((clientX - r.left) / r.width));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [onChange, min, max],
  );

  return (
    <div className="controller number hasSlider" title={title}>
      <div className="name">{label}</div>
      <div className="widget">
        <div
          className="slider"
          ref={track}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            setFromPointer(e.clientX);
          }}
          onPointerMove={(e) => {
            if (e.buttons === 1) setFromPointer(e.clientX);
          }}
        >
          <div className="fill" style={{ width: `${toPos(value) * 100}%` }} />
        </div>
        <input
          type="text"
          value={text ?? (value < 1 ? value.toFixed(2) : value.toFixed(1))}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            if (text !== null) {
              const parsed = Number.parseFloat(text);
              if (Number.isFinite(parsed)) onChange(clamp(parsed));
              setText(null);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      </div>
    </div>
  );
}
