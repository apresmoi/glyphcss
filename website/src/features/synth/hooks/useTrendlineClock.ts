import { useEffect, useRef } from "react";
import { PREVIEW_STATIC_TIME } from "../model/parameters";

// Drives a per-voice waveform trendline SVG on its own rAF clock, with no
// mounted glyphcss scene at all — a managed `VoiceCard` (the /synth sidebar,
// crowding fix) drops its live mini-preview square entirely, but the
// trendline is a pure function of `t` + the voice's own wave params
// (`buildWavePathD`), so it never needed a scene to animate. Same
// tick/start/stop/renderStatic shape as `useSynthPreview` above (so the
// static-until-hovered convention every card preview in this file follows
// stays identical), just without the `host`/scene half of that hook.
// `enabled` gates the whole hook off (a no-op) for a caller passing an
// unmanaged card (`mode` omitted) that still gets its ticks from a real
// mounted `useSynthPreview` scene instead — the two are mutually exclusive
// per card, never both driving the same `onTick`.
export function useTrendlineClock(
  onTick: (t: number) => void,
  deps: unknown[],
  animate: boolean,
  enabled: boolean,
): void {
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;
  const animateRef = useRef(animate);
  animateRef.current = animate;
  const loopRef = useRef<{ start: () => void; stop: () => void; renderStatic: () => void } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let last = performance.now(),
      t = PREVIEW_STATIC_TIME,
      raf = 0;
    const tick = (now: number): void => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      t += dt * 0.8;
      onTickRef.current(t);
    };
    const start = (): void => {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };
    const stop = (): void => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const renderStatic = (): void => {
      stop();
      t = PREVIEW_STATIC_TIME;
      onTickRef.current(t);
    };
    loopRef.current = { start, stop, renderStatic };
    if (animateRef.current) start();
    else renderStatic();
    return () => {
      stop();
      loopRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    if (!animateRef.current) loopRef.current?.renderStatic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);
  useEffect(() => {
    if (!enabled) return;
    if (animate) loopRef.current?.start();
    else loopRef.current?.renderStatic();
  }, [animate, enabled]);
}
