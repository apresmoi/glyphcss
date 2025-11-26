import type { SvelteComponentTyped } from "svelte";
import type { AutoRotateOption, CameraComponentProps, CameraSlotProps } from "@layoutit/voxcss";

export default class VoxCamera extends SvelteComponentTyped<
  CameraComponentProps,
  Record<string, never>,
  { default: CameraSlotProps }
> {
  startAutoRotate(value?: AutoRotateOption): void;
  stopAutoRotate(): void;
}
