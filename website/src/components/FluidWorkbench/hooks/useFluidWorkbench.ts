import { useEffect, useMemo, useRef, useState } from "react";
import { buildFluidSnippet } from "../../../features/fluid/export/fluidSnippets";
import {
  FLUID_DEFAULTS,
  FLUID_READER_DEFAULTS,
  FLUID_READER_IDLE,
  FLUID_STATS_PENDING,
  formatFluidStats,
  type FluidReaderProgress,
  type FluidReaderSettings,
  type FluidSettings,
  type FluidStatsReadout,
} from "../../../features/fluid/model/fluidWorkbench";
import {
  mountFluidField,
  mountFluidReader,
  type FluidReaderMount,
} from "../../../features/fluid/services/fluidRuntime";

export type FluidMobilePanel = "controls" | "stats" | "code" | null;

export function useFluidWorkbench() {
  const fieldHostRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLParagraphElement>(null);
  const readerHostRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<FluidReaderMount | null>(null);

  const [settings, setSettings] = useState<FluidSettings>(FLUID_DEFAULTS);
  const [reader, setReader] = useState<FluidReaderSettings>(FLUID_READER_DEFAULTS);
  const [progress, setProgress] = useState<FluidReaderProgress>(FLUID_READER_IDLE);
  const [stats, setStats] = useState<FluidStatsReadout>(FLUID_STATS_PENDING);
  const [mobilePanel, setMobilePanel] = useState<FluidMobilePanel>(null);
  const [codeOpen, setCodeOpen] = useState(false);

  // Every field option is a constructor option, so a change remounts the fluid.
  useEffect(() => {
    const host = fieldHostRef.current;
    const heading = headingRef.current;
    if (!host || !heading) return;
    setStats(FLUID_STATS_PENDING);
    const mount = mountFluidField(host, heading, settings, (next) => setStats(formatFluidStats(next)));
    return () => mount.destroy();
  }, [settings]);

  // The reader shares the pipeline options; text and wpm are live clock calls below.
  const readerRemountKey = `${settings.encoding}|${settings.fps}|${settings.worker}|${reader.loop}`;
  const readerAtMount = useRef(reader);
  readerAtMount.current = reader;
  useEffect(() => {
    const host = readerHostRef.current;
    if (!host) return;
    const mount = mountFluidReader(host, readerAtMount.current, settings, setProgress);
    readerRef.current = mount;
    return () => {
      readerRef.current = null;
      mount.destroy();
    };
    // Remounts only on what the reader cannot change in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readerRemountKey]);

  const setText = (text: string) => {
    const next = text.trim();
    if (!next || next === reader.text) return;
    setReader((r) => ({ ...r, text: next }));
    readerRef.current?.setText(next);
  };
  const setWpm = (wpm: number) => {
    setReader((r) => ({ ...r, wpm }));
    readerRef.current?.setWpm(wpm);
  };
  const setLoop = (loop: boolean) => setReader((r) => ({ ...r, loop }));
  const togglePlaying = () => readerRef.current?.setPlaying(!progress.playing);
  const updateSettings = (partial: Partial<FluidSettings>) => setSettings((s) => ({ ...s, ...partial }));

  const snippets = useMemo(() => ({ vanilla: buildFluidSnippet(settings, reader) }), [settings, reader]);

  return {
    fieldHostRef,
    headingRef,
    readerHostRef,
    settings,
    updateSettings,
    reader,
    setText,
    setWpm,
    setLoop,
    progress,
    togglePlaying,
    stats,
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
