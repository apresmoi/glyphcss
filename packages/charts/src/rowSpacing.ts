/** Equal gaps keep authored rows aligned; indivisible surplus stays below the content. */
export function glyphChartRowSpacing(naturalRows: number, height: number | undefined, boundaries: readonly number[], scale: number): (row: number) => number {
  const extra = boundaries.length ? Math.min(2, Math.max(0, Math.floor(((height ?? naturalRows) - naturalRows) / (scale * boundaries.length)))) : 0;
  return (row) => row + boundaries.reduce((sum, boundary) => sum + (row >= boundary ? extra : 0), 0) * scale;
}
