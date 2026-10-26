import type { GlyphFluid } from "@glyphcss/fluid";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildFluidSnippet } from "../../../features/fluid/export/fluidSnippets";
import {
  FLUID_DEFAULT_EXAMPLE,
  FLUID_EXAMPLES,
  FLUID_ZONE_LEVELS,
  fluidExampleAttribution,
  fluidExampleDefaults,
  fluidTuningDefaults,
  pruneFluidOverrides,
  pruneFluidTuning,
  type FluidConfig,
  type FluidConfigKey,
  type FluidExample,
  type FluidTunableKey,
  type FluidTuning,
} from "../../../features/fluid/model/fluidExamples";
import {
  encodeFluidConfig,
  encodeFluidTuning,
  FLUID_CONFIG_PARAM,
  FLUID_EXAMPLE_PARAM,
  FLUID_TUNING_PARAM,
  readFluidUrlState,
} from "../../../features/fluid/model/fluidUrlState";
import {
  FLUID_READER_IDLE,
  FLUID_STATS_PENDING,
  formatFluidStats,
  type FluidReaderProgress,
  type FluidStatsReadout,
} from "../../../features/fluid/model/fluidWorkbench";
import {
  mountFluidExampleTarget,
  mountFluidReaderExample,
  mountFluidSurface,
  mountFluidZone,
  rippleFluid,
  type FluidExampleTargetMount,
  type FluidReaderExampleMount,
} from "../../../features/fluid/services/fluidExampleRuntime";
import { writeUrlParam } from "../../../services/url-state/history";

export type FluidMobilePanel = "examples" | "controls" | "code" | null;

const STATS_INTERVAL_MS = 500;

/** The fluid's construction options: any change builds a new fluid. */
const surfaceKeys = [
  "glue",
  "shape",
  "encoding",
  "face",
  "fps",
  "fpsFallback",
  "worker",
  "clock",
  "reducedMotion",
  "pointer",
  "shimmer",
  "fieldColor",
  "fieldLevel",
  "cellAspect",
  "targetCols",
  "minCellPx",
  "maxCellPx",
  "maxCols",
] as const satisfies readonly FluidConfigKey[];
/** The reader's own construction options; text, wpm and play state are live clock calls. */
const readerKeys = [
  "loop",
  "look",
  "font",
  "ripple",
  "readerColor",
  "leadIn",
  "ariaLive",
] as const satisfies readonly FluidConfigKey[];
/** Target options the target reads once; re-adding the target applies them. */
const targetKeys = [
  "color",
  "delay",
  "visibility",
  "ink",
  "meshFeatures",
  "meshSwell",
] as const satisfies readonly FluidConfigKey[];

const pick = (config: FluidConfig, keys: readonly FluidConfigKey[]) => JSON.stringify(keys.map((key) => config[key]));

function initialState() {
  const url = readFluidUrlState(typeof window === "undefined" ? "" : window.location.search);
  return { example: url.example ?? FLUID_DEFAULT_EXAMPLE, overrides: url.config, tuning: url.tuning };
}

export function useFluidWorkbench() {
  const [initial] = useState(initialState);
  const [example, setExample] = useState<FluidExample>(initial.example);
  const [overrides, setOverrides] = useState<Partial<FluidConfig>>(initial.overrides);
  const [tuningOverrides, setTuningOverrides] = useState<FluidTuning>(initial.tuning);
  const [search, setSearch] = useState("");
  const [progress, setProgress] = useState<FluidReaderProgress>(FLUID_READER_IDLE);
  const [stats, setStats] = useState<FluidStatsReadout>(FLUID_STATS_PENDING);
  const [lit, setLit] = useState("–");
  const [error, setError] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<FluidMobilePanel>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  const [fluid, setFluid] = useState<GlyphFluid | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const subjectRef = useRef<HTMLElement | null>(null);
  const readerHostRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<FluidReaderExampleMount | null>(null);
  const targetRef = useRef<FluidExampleTargetMount | null>(null);

  const defaults = useMemo(() => fluidExampleDefaults(example), [example]);
  const config = useMemo<FluidConfig>(() => ({ ...defaults, ...overrides }), [defaults, overrides]);
  const tuningDefaults = useMemo(() => fluidTuningDefaults(example), [example]);
  const tuning = useMemo(() => pruneFluidTuning(tuningOverrides, tuningDefaults), [tuningOverrides, tuningDefaults]);
  const tuningValues = useMemo(() => ({ ...tuningDefaults, ...tuning }), [tuningDefaults, tuning]);
  const isReader = example.kind === "reader";

  const configRef = useRef(config);
  configRef.current = config;
  const tuningJson = JSON.stringify(tuning);

  // The stage's fluid; the reader examples build their own inside the reader below.
  const surfaceKey = `${example.id}|${pick(config, surfaceKeys)}|${tuningJson}`;
  useEffect(() => {
    const host = stageRef.current;
    if (isReader || !host) return;
    setError(null);
    const mount = mountFluidSurface(host, configRef.current, JSON.parse(tuningJson) as FluidTuning);
    setFluid(mount);
    return () => {
      setFluid(null);
      mount.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceKey]);

  const readerKey = `${example.id}|${pick(config, [...surfaceKeys, ...readerKeys])}|${tuningJson}`;
  useEffect(() => {
    const host = readerHostRef.current;
    if (!isReader || !host) return;
    const mount = mountFluidReaderExample(host, configRef.current, JSON.parse(tuningJson) as FluidTuning, setProgress);
    readerRef.current = mount;
    setFluid(mount.fluid);
    return () => {
      readerRef.current = null;
      setFluid(null);
      setProgress(FLUID_READER_IDLE);
      mount.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readerKey]);

  const targetKey = pick(config, targetKeys);
  useEffect(() => {
    const el = subjectRef.current;
    if (!fluid || !el || isReader) return;
    if (example.kind === "zones") {
      const zone = mountFluidZone(fluid, el, configRef.current);
      return () => zone.remove();
    }
    const mount = mountFluidExampleTarget(fluid, example, el, configRef.current, setError);
    targetRef.current = mount;
    return () => {
      targetRef.current = null;
      mount.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fluid, targetKey, example.kind === "zones" ? `${config.zoneKind}|${config.zoneLevel}` : ""]);

  useEffect(() => targetRef.current?.setCondensed(config.condensed), [fluid, config.condensed]);
  useEffect(
    () =>
      targetRef.current?.setMeshView({
        rotX: config.meshRotX,
        rotY: config.meshRotY,
        spin: config.meshSpin,
        extent: config.meshExtent,
        ambient: config.meshAmbient,
      }),
    [fluid, config.meshRotX, config.meshRotY, config.meshSpin, config.meshExtent, config.meshAmbient],
  );

  useEffect(() => {
    if (!fluid) {
      setStats(FLUID_STATS_PENDING);
      setLit("–");
      return;
    }
    const poll = () => {
      const next = fluid.stats();
      setStats(formatFluidStats(next));
      setLit(String(next.lit));
    };
    const timer = window.setInterval(poll, STATS_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [fluid]);

  // Append-only link state: the example, then what differs from its defaults.
  useEffect(() => {
    writeUrlParam(FLUID_EXAMPLE_PARAM, example.id === FLUID_DEFAULT_EXAMPLE.id ? null : example.id);
    writeUrlParam(FLUID_CONFIG_PARAM, encodeFluidConfig(config, defaults));
    writeUrlParam(FLUID_TUNING_PARAM, encodeFluidTuning(tuningValues, tuningDefaults));
  }, [example, config, defaults, tuningValues, tuningDefaults]);

  const update = (partial: Partial<FluidConfig>) => {
    const next = { ...partial };
    // A new zone kind starts at that kind's own floor level.
    if (next.zoneKind && next.zoneLevel === undefined) next.zoneLevel = FLUID_ZONE_LEVELS[next.zoneKind];
    setOverrides((current) => pruneFluidOverrides({ ...current, ...next }, defaults));
    if (next.text !== undefined) readerRef.current?.setText(next.text);
    if (next.wpm !== undefined) readerRef.current?.setWpm(next.wpm);
  };
  const reset = (keys: readonly FluidConfigKey[]) =>
    setOverrides((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !keys.includes(key as FluidConfigKey))),
    );
  const updateTuning = (key: FluidTunableKey, value: number) =>
    setTuningOverrides((current) => pruneFluidTuning({ ...current, [key]: value }, tuningDefaults));

  const selectExample = (id: string) => {
    const next = FLUID_EXAMPLES.find((e) => e.id === id);
    if (!next) return;
    setExample(next);
    // Options keep their values across examples; ones equal to the new defaults drop out.
    setOverrides((current) => pruneFluidOverrides(current, fluidExampleDefaults(next)));
    setMobilePanel(null);
  };
  const randomExample = () => {
    const others = FLUID_EXAMPLES.filter((e) => e.id !== example.id);
    selectExample(others[Math.floor(Math.random() * others.length)]!.id);
  };

  const snippets = useMemo(
    () => ({ vanilla: buildFluidSnippet(example, config, defaults, tuning) }),
    [example, config, defaults, tuning],
  );

  return {
    example,
    selectExample,
    randomExample,
    search,
    setSearch,
    attribution: fluidExampleAttribution(example),
    config,
    defaults,
    update,
    reset,
    tuningValues,
    tuningDefaults,
    updateTuning,
    resetTuning: () => setTuningOverrides({}),
    stageRef,
    subjectRef,
    readerHostRef,
    progress,
    togglePlaying: () => readerRef.current?.setPlaying(!progress.playing),
    ripple: () => {
      const host = isReader ? readerHostRef.current : stageRef.current;
      if (fluid && host) rippleFluid(fluid, host, config.impulseStrength, config.impulseRadius);
    },
    stepFrame: () => fluid?.step(1 / config.fps),
    stats,
    lit,
    error,
    snippets,
    codeOpen,
    toggleCodeOpen: () => setCodeOpen((open) => !open),
    closeCode: () => {
      setCodeOpen(false);
      setMobilePanel(null);
    },
    mobilePanel,
    setMobilePanel,
  };
}
