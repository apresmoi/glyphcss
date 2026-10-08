import styles from "./GlyphScene.module.css";
import { useGlyphScene } from "./hooks/useGlyphScene";
import { type GlyphSceneProps } from "./types";

export function GlyphScene({
  meshUrl,
  selectedPreset,
  options,
  onBuild,
  onCameraChange,
  onStatsChange,
  onAtlasAvailability,
  onAnimationInfoChange,
  selectedAnimation,
  animationPaused,
  animationTimeScale,
  effect,
  semanticOutput = null,
  onSemanticCellLineage,
}: GlyphSceneProps) {
  const view = useGlyphScene({
    meshUrl,
    selectedPreset,
    options,
    onBuild,
    onCameraChange,
    onStatsChange,
    onAtlasAvailability,
    onAnimationInfoChange,
    selectedAnimation,
    animationPaused,
    animationTimeScale,
    effect,
    semanticOutput,
    onSemanticCellLineage,
  });
  if (!view) return null;
  const { hostRef } = view;

  return <div ref={hostRef} className={`dn-vanilla-host ${styles.root}`} />;
}
