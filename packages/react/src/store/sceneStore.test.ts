import { describe, it, expect, vi } from "vitest";
import { createSceneStore, useStoreSelector } from "./sceneStore";
import type { CameraState } from "@layoutit/polycss-core";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const DEFAULT_CAMERA: CameraState = {
  zoom: 1,
  rotX: 30,
  rotY: 45,
  panX: 0,
  panY: 0,
  tilt: 0,
  depthOffset: 0,
  projection: "isometric",
};

describe("createSceneStore", () => {
  it("getState returns the initial camera state", () => {
    const store = createSceneStore(DEFAULT_CAMERA);
    expect(store.getState().cameraState).toEqual(DEFAULT_CAMERA);
  });

  it("setState merges partial state and notifies subscribers", () => {
    const store = createSceneStore(DEFAULT_CAMERA);
    const listener = vi.fn();
    store.subscribe(listener);
    store.setState({ cameraState: { ...DEFAULT_CAMERA, zoom: 2 } });
    expect(store.getState().cameraState.zoom).toBe(2);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("subscribe returns an unsubscribe function that stops notifications", () => {
    const store = createSceneStore(DEFAULT_CAMERA);
    const listener = vi.fn();
    const unsub = store.subscribe(listener);
    // Fire once — listener gets called
    store.setState({ cameraState: { ...DEFAULT_CAMERA, zoom: 3 } });
    expect(listener).toHaveBeenCalledTimes(1);
    // Unsubscribe, then fire again — listener not called again
    unsub();
    store.setState({ cameraState: { ...DEFAULT_CAMERA, zoom: 4 } });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("updateCameraFromRef sets state from the handle and returns true", () => {
    const store = createSceneStore(DEFAULT_CAMERA);
    const listener = vi.fn();
    store.subscribe(listener);
    const newState: CameraState = { ...DEFAULT_CAMERA, zoom: 5 };
    const handle = { state: newState } as unknown as import("@layoutit/polycss-core").CameraHandle;
    const result = store.updateCameraFromRef(handle);
    expect(result).toBe(true);
    expect(store.getState().cameraState).toEqual(newState);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("notifyAll fires all subscribers without changing state", () => {
    const store = createSceneStore(DEFAULT_CAMERA);
    const a = vi.fn();
    const b = vi.fn();
    store.subscribe(a);
    store.subscribe(b);
    store.notifyAll();
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
    // State unchanged
    expect(store.getState().cameraState).toEqual(DEFAULT_CAMERA);
  });

  it("multiple subscribers all receive notifications", () => {
    const store = createSceneStore(DEFAULT_CAMERA);
    const a = vi.fn();
    const b = vi.fn();
    store.subscribe(a);
    store.subscribe(b);
    store.setState({ cameraState: { ...DEFAULT_CAMERA, zoom: 9 } });
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });
});

describe("useStoreSelector", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders a slice of the store and re-renders only when selected value changes", () => {
    const store = createSceneStore(DEFAULT_CAMERA);
    const renders: number[] = [];

    function TestComponent() {
      const zoom = useStoreSelector(store, (s) => s.cameraState.zoom);
      renders.push(zoom);
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(React.createElement(TestComponent)));
    expect(renders).toEqual([1]);

    // Update zoom — should re-render
    act(() => store.setState({ cameraState: { ...DEFAULT_CAMERA, zoom: 7 } }));
    expect(renders).toContain(7);
  });
});

// Bring in afterEach from vitest
import { afterEach } from "vitest";
