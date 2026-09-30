export type AsciiCell = { ch: string; color?: string };

export type TrimmedStrip = { rows: AsciiCell[][]; left: number; right: number; top: number; bottom: number };
