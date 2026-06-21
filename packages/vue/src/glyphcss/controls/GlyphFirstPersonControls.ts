/**
 * GlyphFirstPersonControls — Vue 3 first-person controls for GlyphScene.
 * Pointer-lock mouselook, WASD/arrow planar move, Space jump, Ctrl crouch.
 * Mirrors voxcss PolyFirstPersonControls.
 */
import { defineComponent, inject, onBeforeUnmount, watch, shallowRef, watchEffect } from "vue";
import type { GlyphFirstPersonControlsHandle, GlyphFirstPersonControlsOptions } from "glyphcss";
import { createGlyphFirstPersonControls } from "glyphcss";
import { GlyphSceneContextKey } from "../scene/context";

export interface GlyphFirstPersonControlsProps {
  enabled?: boolean;
  lookEnabled?: boolean;
  moveEnabled?: boolean;
  jumpEnabled?: boolean;
  crouchEnabled?: boolean;
  lookSensitivity?: number;
  invertY?: boolean;
  moveSpeed?: number;
  jumpVelocity?: number;
  gravity?: number;
  eyeHeight?: number;
  crouchHeight?: number;
  groundZ?: number;
  minPitch?: number;
  maxPitch?: number;
}

export const GlyphFirstPersonControls = defineComponent({
  name: "GlyphFirstPersonControls",
  props: {
    enabled: { type: Boolean, default: undefined },
    lookEnabled: { type: Boolean, default: undefined },
    moveEnabled: { type: Boolean, default: undefined },
    jumpEnabled: { type: Boolean, default: undefined },
    crouchEnabled: { type: Boolean, default: undefined },
    lookSensitivity: { type: Number, default: undefined },
    invertY: { type: Boolean, default: undefined },
    moveSpeed: { type: Number, default: undefined },
    jumpVelocity: { type: Number, default: undefined },
    gravity: { type: Number, default: undefined },
    eyeHeight: { type: Number, default: undefined },
    crouchHeight: { type: Number, default: undefined },
    groundZ: { type: Number, default: undefined },
    minPitch: { type: Number, default: undefined },
    maxPitch: { type: Number, default: undefined },
  },
  setup(props) {
    const sceneCtx = inject(GlyphSceneContextKey);
    if (!sceneCtx) {
      throw new Error("glyphcss: GlyphFirstPersonControls must be used inside a GlyphScene.");
    }
    const { sceneRef } = sceneCtx;
    const controlsRef = shallowRef<GlyphFirstPersonControlsHandle | null>(null);

    const optsFromProps = (): GlyphFirstPersonControlsOptions => ({
      enabled: props.enabled,
      lookEnabled: props.lookEnabled,
      moveEnabled: props.moveEnabled,
      jumpEnabled: props.jumpEnabled,
      crouchEnabled: props.crouchEnabled,
      lookSensitivity: props.lookSensitivity,
      invertY: props.invertY,
      moveSpeed: props.moveSpeed,
      jumpVelocity: props.jumpVelocity,
      gravity: props.gravity,
      eyeHeight: props.eyeHeight,
      crouchHeight: props.crouchHeight,
      groundZ: props.groundZ,
      minPitch: props.minPitch,
      maxPitch: props.maxPitch,
    });

    // In Vue 3, child onMounted hooks fire before parent onMounted, so
    // sceneRef.value is null when this runs. Watch for the scene to appear.
    const stopWatch = watchEffect(() => {
      const scene = sceneRef.value;
      if (!scene || controlsRef.value) return;
      controlsRef.value = createGlyphFirstPersonControls(scene, optsFromProps());
    });

    onBeforeUnmount(() => {
      stopWatch();
      controlsRef.value?.destroy();
      controlsRef.value = null;
    });

    watch(optsFromProps, (next) => {
      controlsRef.value?.update(next);
    });

    return () => null;
  },
});
