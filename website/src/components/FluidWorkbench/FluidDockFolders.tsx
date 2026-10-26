import type { FluidStatsReadout } from "../../features/fluid/model/fluidWorkbench";
import { useDockGui, useFolder, useReadonlyText } from "../Dock";

/** Live pipeline readouts of the viewport's fluid, as read-only Dock rows. */
export function FluidDockFolders({ stats }: { stats: FluidStatsReadout }) {
  const folder = useFolder(useDockGui(), "Pipeline", { open: true });
  useReadonlyText(folder, "fps", stats.fps);
  useReadonlyText(folder, "pipeline", stats.pipeline);
  useReadonlyText(folder, "cols × rows", stats.grid);
  useReadonlyText(folder, "step ms", stats.stepMs);
  return null;
}
