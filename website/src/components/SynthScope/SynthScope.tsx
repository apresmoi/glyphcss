import { useEffect, useRef } from "react";
import { type Params } from "../../features/synth/model/parameters";
import { MAX_VOICES } from "../../features/synth/model/urlState";
import { type CombinedVoice, buildCombinedPathD, buildWavePathD } from "../../features/synth/model/waves";
import styles from "./SynthScope.module.css";

// Combined-waveform oscilloscope, portaled into the right Dock's MIX folder
// (above Combine — see `useDockSlot(mix, { position: "top" })` in `SynthDock`):
// each active voice's raw wave faint in its own color, the real mixed result
// bold on top — the fastest way to SEE interference (two close frequencies
// drifting in and out of phase = a visible beating envelope). One shared rAF
// loop for the whole strip (not one per voice), driven by the SAME
// paused/time-scale refs that drive the actual mounted scene, so it tracks
// what's on screen rather than free-running on its own clock.
export function SynthScope({
  paramsRef,
  tsRef,
  pausedRef,
}: {
  paramsRef: { current: Params };
  tsRef: { current: number };
  pausedRef: { current: boolean };
}) {
  const voicePathRefs = useRef<(SVGPathElement | null)[]>(Array.from({ length: MAX_VOICES }, () => null));
  const mixPathRef = useRef<SVGPathElement | null>(null);
  const width = 200,
    height = 56;
  useEffect(() => {
    let raf = 0,
      last = performance.now(),
      t = 0;
    const tick = (now: number): void => {
      raf = requestAnimationFrame(tick);
      if (!pausedRef.current) t += Math.min((now - last) / 1000, 0.1) * tsRef.current;
      last = now;
      const p = paramsRef.current;
      const combineMode = String(p.combine ?? "multiply");
      const active: CombinedVoice[] = [];
      for (let k = 0; k < MAX_VOICES; k++) {
        const slot = k + 1;
        const amp = Number(p[`amp${slot}`] ?? 0);
        const path = voicePathRefs.current[k];
        if (!(amp > 0)) {
          path?.setAttribute("d", "");
          continue;
        }
        const voice: CombinedVoice = {
          wave: String(p[`wave${slot}`]),
          freq: Number(p[`freq${slot}`]),
          speed: Number(p[`speed${slot}`]),
          amp,
          duty: Number(p[`duty${slot}`] ?? 0.5),
          phase: Number(p[`phase${slot}`] ?? 0),
        };
        active.push(voice);
        if (path) {
          path.setAttribute(
            "d",
            buildWavePathD(voice.wave, voice.freq, voice.speed, voice.amp, t, width, height, voice.duty, voice.phase),
          );
          path.style.stroke = String(p[`color${slot}`] ?? "#7df9ff");
        }
      }
      mixPathRef.current?.setAttribute(
        "d",
        active.length > 0 ? buildCombinedPathD(active, combineMode, t, width, height) : "",
      );
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paramsRef, tsRef, pausedRef]);
  return (
    <div className={styles.root + " dock-scope"} aria-hidden="true">
      <span className="dock-scope-label">Scope</span>
      <svg className="dock-scope-plot" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} className="dock-scope-mid" />
        {Array.from({ length: MAX_VOICES }, (_, k) => (
          <path
            key={k}
            ref={(el) => {
              voicePathRefs.current[k] = el;
            }}
            className="dock-scope-voice"
            vectorEffect="non-scaling-stroke"
            fill="none"
          />
        ))}
        <path ref={mixPathRef} className="dock-scope-mix" vectorEffect="non-scaling-stroke" fill="none" />
      </svg>
    </div>
  );
}
