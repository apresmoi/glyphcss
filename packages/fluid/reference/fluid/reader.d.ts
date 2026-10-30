// Types for the vendored reference speed-reader rules (tests only; never shipped).
export interface ReaderToken { word: string; orp: number; core: number; para: boolean }
export function orpOf(tok: string): { focal: number; core: number };
export function tokenize(text: string): ReaderToken[];
export function wordDelay(tok: ReaderToken, wpm: number): number;
