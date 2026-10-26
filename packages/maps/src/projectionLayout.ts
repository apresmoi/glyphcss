/** Only dimensions are retained; camera centres are recomputed by the widget. */
export function createGlyphMapProjectionLayout(host: HTMLElement, output: HTMLElement) {
  let cached: { hostWidth: number; hostHeight: number; outputWidth: number; outputHeight: number } | undefined;
  let key: readonly unknown[] = [];
  const invalidate = () => { cached = undefined; };
  const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(invalidate);
  observer?.observe(host); observer?.observe(output);
  const fonts = host.ownerDocument.fonts;
  fonts?.addEventListener("loadingdone", invalidate);
  fonts?.addEventListener("loadingerror", invalidate);
  const keyOf = (cols: number, rows: number, aspect: number) => [cols, rows, aspect, host.style.cssText, host.className,
    output.style.cssText, output.className, output.childNodes.length === 0];
  return {
    invalidate,
    /** Seed dimensions already known to be right for the NEXT render, while the DOM still holds an earlier frame's text. */
    prime(cols: number, rows: number, aspect: number, dims: { hostWidth: number; hostHeight: number; outputWidth: number; outputHeight: number }) {
      cached = { ...dims };
      key = keyOf(cols, rows, aspect);
    },
    read(cols: number, rows: number, aspect: number) {
      // Font/size options can change synchronously inside a scene render,
      // before ResizeObserver delivers. Empty -> populated output also changes
      // its intrinsic size on the first commit, without an option change.
      const next = keyOf(cols, rows, aspect);
      if (!observer || !cached || next.some((v, i) => v !== key[i])) {
        const h = host.getBoundingClientRect(), o = output.getBoundingClientRect();
        cached = { hostWidth: h.width, hostHeight: h.height, outputWidth: o.width, outputHeight: o.height };
        key = next;
      }
      return cached;
    },
    dispose() {
      observer?.disconnect();
      fonts?.removeEventListener("loadingdone", invalidate);
      fonts?.removeEventListener("loadingerror", invalidate);
      invalidate();
    },
  };
}
