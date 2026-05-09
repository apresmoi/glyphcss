import { describe, it, expect, vi } from "vitest";
import { createSceneStore } from "./sceneStore";
import type { CameraState } from "@layoutit/polycss-core";

const INITIAL: CameraState = {
  zoom: 1,
  pan: 0,
  tilt: 0,
  rotX: 0,
  rotY: 0,
};

describe("createSceneStore", () => {
  it("getState returns initial state", () => {
    const store = createSceneStore(INITIAL);
    expect(store.getState().cameraState).toEqual(INITIAL);
  });

  it("setState merges partial state and notifies listeners (line 41-43)", () => {
    const store = createSceneStore(INITIAL);
    const listener = vi.fn();
    store.subscribe(listener);

    const nextCamera: CameraState = { ...INITIAL, zoom: 2 };
    store.setState({ cameraState: nextCamera });

    expect(store.getState().cameraState.zoom).toBe(2);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("setState with multiple listeners notifies all", () => {
    const store = createSceneStore(INITIAL);
    const l1 = vi.fn();
    const l2 = vi.fn();
    store.subscribe(l1);
    store.subscribe(l2);

    store.setState({ cameraState: { ...INITIAL, pan: 5 } });
    expect(l1).toHaveBeenCalledOnce();
    expect(l2).toHaveBeenCalledOnce();
  });

  it("subscribe returns an unsubscribe function that removes the listener (line 46-48)", () => {
    const store = createSceneStore(INITIAL);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.setState({ cameraState: { ...INITIAL, zoom: 3 } });
    expect(listener).toHaveBeenCalledOnce();

    // Unsubscribe then trigger again — listener must NOT be called again
    unsubscribe();
    store.setState({ cameraState: { ...INITIAL, zoom: 4 } });
    expect(listener).toHaveBeenCalledOnce(); // still only once
  });

  it("updateCameraFromRef replaces cameraState from handle and returns true", () => {
    const store = createSceneStore(INITIAL);
    const listener = vi.fn();
    store.subscribe(listener);

    const mockHandle = {
      state: { ...INITIAL, zoom: 5, tilt: 10 },
    } as unknown as Parameters<typeof store.updateCameraFromRef>[0];

    const result = store.updateCameraFromRef(mockHandle);
    expect(result).toBe(true);
    expect(store.getState().cameraState.zoom).toBe(5);
    expect(store.getState().cameraState.tilt).toBe(10);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("notifyAll fires all subscribers without changing state", () => {
    const store = createSceneStore(INITIAL);
    const listener = vi.fn();
    store.subscribe(listener);

    store.notifyAll();
    expect(listener).toHaveBeenCalledOnce();
    expect(store.getState().cameraState).toEqual(INITIAL);
  });

  it("subscribe with zero listeners: setState does not throw", () => {
    const store = createSceneStore(INITIAL);
    expect(() => store.setState({ cameraState: { ...INITIAL, pan: 99 } })).not.toThrow();
  });
});
