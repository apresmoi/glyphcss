import { GLYPH_DIAGRAM_DAGRE_ALIGN, GLYPH_DIAGRAM_DAGRE_ALIGNMENTS } from "./fitAlignment";
import type { GlyphDiagramLedgerEntry } from "./ledger";
import { glyphDiagramCenterOffset } from "./center";
import { glyphDiagramCompactionFloor } from "./degrade";
import { glyphDiagramText } from "./labels";
import { glyphDiagramSnakeLayout } from "./snake";
import { paintGlyphDiagram } from "./paint";
import { GLYPH_DIAGRAM_LOOP_LABEL_MAX } from "./loop";
import { glyphDiagramFoldLabel, glyphDiagramGroupDepths, glyphDiagramGroupParents, glyphDiagramWords, glyphDiagramWrap, layoutGlyphGraph, measureGlyphGraph, reserveGlyphGraphPorts, type GlyphDiagramLayout, type GlyphDiagramLayoutOptions, type GlyphDiagramReservedGraph } from "./pipeline";
import { GLYPH_DIAGRAM_ROUTE_SEPARATION, glyphDiagramHasRoutingClearance, glyphDiagramLoopsClear, routeGlyphGraphEdges, type GlyphDiagramRoutingResult } from "./route";
import type { GlyphGraph } from "./types";

export interface GlyphDiagramFitOptions extends GlyphDiagramLayoutOptions {
  readonly width: number;
  readonly height: number;
  readonly autoDirection?: boolean;
  readonly overflow?: "paginate" | "expand";
  /** Stop before cutting a word (default true). The nested-frame fallback uses it to try the cheaper layouts first. */
  readonly cutWords?: boolean;
}
export interface GlyphDiagramAttempt {
  readonly layout: GlyphDiagramLayout;
  readonly routing: GlyphDiagramRoutingResult;
  readonly fits: boolean;
  readonly okay: boolean;
  readonly width: number;
  readonly height: number;
  readonly adjusted: boolean;
}
interface Candidate { readonly raw: GlyphDiagramLayout; readonly adjusted: boolean; readonly nodesep: number; readonly ranksep: number; readonly margin: number }
const MAX_TALL_SNAKES = 3;
const MAX_LOOP_WRAPS = 3;
const MAX_EXPAND_PROBES = 256;
const MAX_GUTTER_PROBES = 128;
const MAX_EXPAND_ROUTING = 384;
const perpendicular: Record<GlyphGraph["direction"], GlyphGraph["direction"]> = { TB: "LR", LR: "TB", BT: "RL", RL: "BT" };

function routeAttempt(candidate: Candidate, width: number, height: number, stopOnFailure = false): GlyphDiagramAttempt {
  const { raw, adjusted } = candidate;
  const { dx, dy } = glyphDiagramCenterOffset(raw, { width, height });
  const layout = { ...raw,
    nodes: raw.nodes.map(n => ({ ...n, x0: n.x0 + dx, x1: n.x1 + dx, y0: n.y0 + dy, y1: n.y1 + dy })),
    ports: raw.ports.map(p => ({ ...p, anchor: { x: p.anchor.x + dx, y: p.anchor.y + dy }, escape: { x: p.escape.x + dx, y: p.escape.y + dy } })),
  };
  const fits = raw.width <= width && raw.height <= height;
  const routing = fits ? routeGlyphGraphEdges(layout, { width, height, stopOnFailure }) : { routes: [], unroutable: [], ledger: [] };
  // A loop that fits nowhere is not a routing failure the search would notice: its label would only be dropped.
  return { layout, routing, fits, okay: fits && routing.unroutable.length === 0 && glyphDiagramLoopsClear(layout), width, height, adjusted };
}

/**
 * Uniform snake row gaps to start from, shortest total first: 3 rows let an
 * edge turn between its two port lanes, and each more edge turning there can
 * need one more. Gaps then shrink one at a time below that.
 */
function snakeGaps(edges: number, floor: number): readonly (readonly [number, number])[] {
  const most = floor + edges;
  return Array.from({ length: most - floor + 1 }, (_, r) => Array.from({ length: most - floor + 1 }, (_, b) => [r + floor, b + floor] as const))
    .flat().sort((a, b) => a[0] + a[1] - b[0] - b[1] || a[0] - b[0]);
}

/** Total route length and bends: a tighter gap must not buy its rows with a detour. */
function routeShape(result: GlyphDiagramAttempt): readonly [number, number] {
  let cells = 0, bends = 0;
  for (const route of result.routing.routes) {
    cells += route.cells.length;
    for (let i = 2; i < route.cells.length; i++) {
      const [a, b, c] = [route.cells[i - 2]!, route.cells[i - 1]!, route.cells[i]!];
      if ((b.x - a.x) !== (c.x - b.x) || (b.y - a.y) !== (c.y - b.y)) bends++;
    }
  }
  return [cells, bends];
}

function dropsEdgeLabel(result: GlyphDiagramAttempt, options: GlyphDiagramFitOptions): boolean {
  const painted = paintGlyphDiagram(result.layout, result.routing, { ...options, width: result.width, height: result.height });
  return painted.ledger.some(entry => entry.code === "label-dropped");
}

/** Resolve geometry in cells; output encoding and font metrics never enter this search. */
export async function fitGlyphGraph(graph: GlyphGraph, options: GlyphDiagramFitOptions): Promise<GlyphDiagramAttempt> {
  const nested = Math.max(0, ...glyphDiagramGroupDepths(glyphDiagramGroupParents(graph.groups ?? [])).values()) > 0;
  if (!nested) return fitAligned(graph, options);
  // Frames padded outside the frames they hold are a preference, not a requirement: they cost a few cells on every side, so a
  // graph that only fits with frames sharing a border still gets them before it is cut into panels or its words are cut.
  const limits: GlyphDiagramLedgerEntry[] = [];
  const fit = async (opts: GlyphDiagramFitOptions) => {
    const result = await fitAligned(graph, opts);
    limits.push(...result.layout.ledger.filter(entry => entry.code === "fit-search-limited"));
    return result;
  };
  const finish = (result: GlyphDiagramAttempt) => limits.length
    ? { ...result, layout: { ...result.layout, ledger: [...result.layout.ledger, ...limits] } } : result;
  const padded = await fit({ ...options, frameInset: true, cutWords: false });
  if (padded.okay) return finish(padded);
  const shared = await fit({ ...options, frameInset: false, cutWords: false });
  if (shared.okay) return finish(shared);
  const cutPadded = await fit({ ...options, frameInset: true });
  if (cutPadded.okay) return finish(cutPadded);
  const cutShared = await fit({ ...options, frameInset: false });
  return finish(cutShared.okay ? cutShared : cutPadded);
}

interface SnakeSearch { readonly fit?: GlyphDiagramAttempt; readonly tall: Candidate[] }
interface FitSearch {
  readonly work: { expansionRoutes: number };
  readonly snakes: Map<number, SnakeSearch>;
  readonly layouts: Map<string, GlyphDiagramLayout>;
  readonly attempts: Map<string, GlyphDiagramAttempt>;
  readonly ledger: GlyphDiagramLedgerEntry[];
  readonly maxWidth?: number;
  readonly maxHeight?: number;
}

function cutsWords(result: GlyphDiagramAttempt, charset: GlyphDiagramFitOptions["charset"]): boolean {
  const cut = (label: string, lines: readonly string[]) => {
    const shown = new Set(lines.flatMap(glyphDiagramWords));
    return glyphDiagramWords(glyphDiagramFoldLabel(label, charset)).some(piece => !shown.has(piece));
  };
  return result.layout.nodes.some(node => node.shape !== "point" && cut(node.label, node.lines))
    || result.layout.loops.some(loop => cut(result.layout.edges.find(edge => edge.id === loop.edgeId)?.label ?? "", loop.lines));
}

async function fitAligned(graph: GlyphGraph, options: GlyphDiagramFitOptions): Promise<GlyphDiagramAttempt> {
  const search: FitSearch = { attempts: new Map(), layouts: new Map(), snakes: new Map(), ledger: [], work: { expansionRoutes: 0 } };
  const initial = await fitOnce(graph, options, search, true);
  // A closed return corridor is a geometry failure, not a wrapping failure.
  // Try the same labels with BK alignment and one extra cell on either gap
  // before exhaustively wrapping/cutting them. Failed probes remain cached
  // for the full search; a passing default still keeps its exact output.
  if (initial.fits && !initial.okay && !cutsWords(initial, options.charset)) {
    const ns = options.nodesep ?? 4, rs = options.ranksep ?? 4;
    let repaired: GlyphDiagramAttempt | undefined;
    for (const align of [undefined, ...GLYPH_DIAGRAM_DAGRE_ALIGNMENTS]) {
      for (const [nodesep, ranksep] of [[ns, rs], [ns + 1, rs], [ns, rs + 1]]) {
        const result = await fitOnce(graph, { ...options, nodesep, ranksep, [GLYPH_DIAGRAM_DAGRE_ALIGN]: align } as GlyphDiagramFitOptions, search, true);
        if (!result.okay || cutsWords(result, options.charset)) continue;
        const [cells, bends] = routeShape(result), [bestCells, bestBends] = repaired ? routeShape(repaired) : [Infinity, Infinity];
        if (bends < bestBends || (bends === bestBends && cells < bestCells)) repaired = result;
        break;
      }
    }
    if (repaired) return { ...repaired, adjusted: true };
  }
  const first = await fitOnce(graph, options, search);
  let best = first;
  if (!first.okay || cutsWords(first, options.charset)) {
    // A passing default keeps its exact text. Alternatives may improve fidelity
    // within its canvas, but must not trade readable labels for more scrolling.
    const bounded = { ...search, maxWidth: first.okay ? first.width : undefined, maxHeight: first.okay ? first.height : undefined };
    for (const align of GLYPH_DIAGRAM_DAGRE_ALIGNMENTS) {
      const result = await fitOnce(graph, { ...options, [GLYPH_DIAGRAM_DAGRE_ALIGN]: align } as GlyphDiagramFitOptions, bounded);
      if (!result.okay) continue;
      // Alignment is a width trade, not permission to make routing more tangled.
      if (first.okay && routeShape(result)[1] > routeShape(first)[1]) continue;
      if (!best.okay || result.width < best.width || (result.width === best.width && result.height < best.height)
        || (result.width === best.width && result.height === best.height && cutsWords(best, options.charset) && !cutsWords(result, options.charset))) {
        best = result;
        bounded.maxWidth = result.width; bounded.maxHeight = result.height;
      }
    }
  }
  return search.ledger.length ? { ...best, layout: { ...best.layout, ledger: [...best.layout.ledger, ...search.ledger] } } : best;
}

async function fitOnce(graph: GlyphGraph, options: GlyphDiagramFitOptions, search: FitSearch, initialOnly = false): Promise<GlyphDiagramAttempt> {
  const attempt = (candidate: Candidate, width: number, height: number, stopOnFailure = false): GlyphDiagramAttempt => {
    // Identical BK alignments share centered routes, including unsuccessful
    // probes. Wrap text and loop geometry are part of the identity.
    const key = JSON.stringify([candidate.raw, width, height, stopOnFailure]);
    const known = search.attempts.get(key);
    if (known) return { ...known, adjusted: candidate.adjusted };
    if (stopOnFailure) search.work.expansionRoutes++;
    const result = routeAttempt(candidate, width, height, stopOnFailure);
    search.attempts.set(key, result);
    return result;
  };
  const layout = async (graph: GlyphGraph | GlyphDiagramReservedGraph, opts: GlyphDiagramLayoutOptions) => {
    const align = (opts as GlyphDiagramLayoutOptions & { [GLYPH_DIAGRAM_DAGRE_ALIGN]?: string })[GLYPH_DIAGRAM_DAGRE_ALIGN];
    // With one node, BK can only translate it; normalization removes that.
    const key = JSON.stringify([graph, opts, graph.nodes.length === 1 ? undefined : align]);
    const known = search.layouts.get(key);
    if (known) return known;
    const result = await layoutGlyphGraph(graph, opts);
    search.layouts.set(key, result);
    return result;
  };
  const { width, height } = options;
  const direction = options.direction ?? graph.direction;
  const directions = options.autoDirection ? [direction, perpendicular[direction]] : [direction];
  const nodesep = options.nodesep ?? 4, ranksep = options.ranksep ?? 4, margin = options.margin ?? 1;
  const longest = Math.max(1, ...graph.nodes.flatMap(node => node.label.split(/\r?\n/).map(line => glyphDiagramText(line, options.charset).length)));
  const labelWidth = options.labelWidth ?? longest;
  // Keep validation at the public layout boundary, including explicit values
  // that an already-impossible viewport would otherwise prune before layout.
  const initial: Candidate = { raw: await layout(graph, { ...options, direction, labelWidth }), adjusted: false, nodesep, ranksep, margin };
  const first = attempt(initial, width, height);
  if (first.okay || initialOnly) return first;

  const floor = glyphDiagramCompactionFloor(graph);
  const candidates: Candidate[] = [initial];
  // A loop's label wraps too, whole words only, widest first: each distinct break of every loop label is a width to try. All the
  // loops on one node stack beside (or under) it, so what a break needs is the combined footprint of the node's loops.
  const fold = (label: string) => label.split(/\r?\n/).map(line => glyphDiagramText(line, options.charset)).join("\n");
  const loopHosts = new Map<string, string[]>();
  for (const edge of graph.edges) if (edge.from === edge.to) loopHosts.set(edge.from, [...(loopHosts.get(edge.from) ?? []), edge.label?.trim() ? fold(edge.label) : ""]);
  const loopLabels = [...loopHosts.values()].flat().filter(label => label);
  const stackRows = (k: number) => Math.max(3, k + 1), stackCols = (cols: number) => cols > 0 ? cols + 4 : 3;
  /** The cells a node's stacked loops need: across a top-down node, `rows` down its side and `cols` of its widest label; under a left-to-right one, `cols` along its bottom to the last label's end and `rows` of its tallest label. */
  const footprint = (across: boolean, loops: readonly (readonly string[])[]) => {
    const ks = loops.map(lines => lines.length), ls = loops.map(lines => Math.max(0, ...lines.map(line => line.length)));
    // The last loop's label reaches furthest, and any of them may be last: the least it can need is a lower bound.
    const rows = across ? Math.min(...ks.map((k, j) => 1 + ks.reduce((sum, other, i) => i === j ? sum : sum + stackRows(other), 0) + Math.max(k, 3))) : Math.max(...ks);
    const cols = across ? Math.max(...ls) : Math.min(...ls.map((l, j) => 1 + ls.reduce((sum, other, i) => i === j ? sum : sum + stackCols(other), 0) + 2 + l));
    return { rows, cols };
  };
  const loopBreaks: { readonly w: number; readonly hosts: (readonly string[])[][] }[] = [];
  {
    const widest = Math.min(options.loopLabelWidth ?? GLYPH_DIAGRAM_LOOP_LABEL_MAX, Math.max(1, ...loopLabels.flatMap(label => label.split("\n").map(line => line.length))));
    const word = Math.max(1, ...loopLabels.flatMap(label => glyphDiagramWords(label).map(part => part.length)));
    const seen = new Set<string>();
    for (let w = widest; w >= Math.min(widest, word); w--) {
      const hosts = [...loopHosts.values()].map(labels => labels.map(label => label ? glyphDiagramWrap(label, w) : []));
      const key = JSON.stringify(hosts);
      if (!seen.has(key)) { seen.add(key); loopBreaks.push({ w, hosts }); }
    }
  }
  // Every label wrap is searched against every loop wrap. Only breaks that could fit the canvas in this direction are searched
  // (beside a node a label needs its width plus the node and the loop, below one its rows plus the node's; rows are free when the
  // canvas may grow), and when none could, three spread across all of them, so a growing canvas still has something to grow from.
  // The snake and the layout search take the same list.
  const loopWrapsCache = new Map<string, number[]>();
  const loopWrapsFor = (dir: GlyphGraph["direction"]): number[] => {
    const known = loopWrapsCache.get(dir);
    if (known) return known;
    const across = dir === "TB" || dir === "BT";
    const possible = loopBreaks.filter(({ hosts }) => hosts.every(loops => {
      const { rows, cols } = footprint(across, loops);
      const rowsFit = options.overflow === "expand" || (across ? rows <= height : rows <= height - 4);
      return rowsFit && (across ? cols <= width - 8 : cols <= width - 1);
    }));
    const pool = possible.length ? possible : loopBreaks;
    const few3 = (list: typeof pool) => list.length > MAX_LOOP_WRAPS ? [list[0]!, list[Math.floor(list.length / 2)]!, list[list.length - 1]!] : list;
    const widths = (possible.length ? pool : few3(pool)).map(({ w }) => w);
    loopWrapsCache.set(dir, widths);
    return widths;
  };
  // A loop and its label take rows of the gap below their node, and the edge wrapping to the next row turns in what is left.
  const loopRows = loopLabels.length || graph.edges.some(edge => edge.from === edge.to) ? 2 : 0;
  const measured: { readonly reserved: GlyphDiagramReservedGraph; readonly wrap: number }[] = [];
  const seenMeasurements = new Set<string>();
  // Every distinct measurable wrap is considered. The upper bound comes from
  // authored text and the available cells, not a list of preferred resolutions.
  for (let wrap = Math.min(labelWidth, Math.max(1, width - 4)); wrap >= 1; wrap--) {
    for (const dir of directions) for (const loopLabelWidth of loopWrapsFor(dir)) {
      const reserved = reserveGlyphGraphPorts(measureGlyphGraph(graph, { ...options, direction: dir, labelWidth: wrap, loopLabelWidth }));
      const key = JSON.stringify([dir, reserved.nodes.map(node => [node.width, node.height]), reserved.loops.map(loop => loop.lines)]);
      if (seenMeasurements.has(key)) continue;
      seenMeasurements.add(key);
      measured.push({ reserved, wrap });
    }
  }

  const seenLayouts = new Set<string>();
  const geometryKey = (raw: GlyphDiagramLayout) => JSON.stringify([raw.direction, raw.width, raw.height,
    raw.nodes.map(node => [node.id, node.x0, node.y0, node.x1, node.y1]),
    raw.ports.map(port => [port.edgeId, port.end, port.side, port.anchor, port.escape])]);
  seenLayouts.add(geometryKey(initial.raw));
  const layoutInputs = new Set<string>();
  const place = async (reserved: GlyphDiagramReservedGraph, ns: number, rs: number, pad: number) => {
    // The two spacing axes converge on the same candidates through different
    // parents. Deduplicate before Dagre, not only after it has done the work.
    const key = JSON.stringify([reserved.direction, reserved.nodes.map(node => [node.width, node.height]), reserved.loops.map(loop => loop.lines), ns, rs, pad]);
    if (layoutInputs.has(key)) return;
    layoutInputs.add(key);
    const raw = await layout(reserved, { ...options, nodesep: ns, ranksep: rs, margin: pad });
    const geometry = geometryKey(raw);
    if (seenLayouts.has(geometry)) return;
    seenLayouts.add(geometry);
    return raw;
  };
  const marginCount = Math.min(margin, Math.floor(Math.min(width, height) / 2)) + 1;
  const margins = Array.from({ length: marginCount }, (_, i) => marginCount - i - 1);
  const tryLayout = async (reserved: GlyphDiagramReservedGraph, ns: number, rs: number, pad: number) => {
    const raw = await place(reserved, ns, rs, pad);
    if (!raw) return;
    const candidate = { raw, adjusted: true, nodesep: ns, ranksep: rs, margin: pad };
    candidates.push(candidate);
    if (raw.width > width || raw.height > height || !glyphDiagramHasRoutingClearance(raw)) return;
    const result = attempt(candidate, width, height);
    return result.okay ? result : undefined;
  };
  const compact: Array<readonly [number, number]> = [];
  for (let ns = nodesep; ns >= Math.min(nodesep, floor); ns--) {
    for (let rs = ranksep; rs >= Math.min(ranksep, floor); rs--) compact.push([ns, rs]);
  }
  compact.sort((a, b) => (nodesep - a[0]) + (ranksep - a[1]) - (nodesep - b[0]) - (ranksep - b[1]));
  // A wrap narrower than the longest word cuts words mid-letter ("Deplo"/"y"),
  // so whole-word wraps go first, then the snake, and cut words only last.
  const longestWord = Math.max(1, ...graph.nodes.flatMap(node => glyphDiagramText(node.label, options.charset).split(/\s+/).map(word => word.length)));
  const longestPiece = Math.max(1, ...graph.nodes.flatMap(node => glyphDiagramWords(glyphDiagramText(node.label, options.charset)).map(word => word.length)));
  const tryMeasured = async (keep: (wrap: number) => boolean, only?: GlyphGraph["direction"]) => {
    for (const { reserved, wrap } of measured) {
      if (!keep(wrap) || (only && reserved.direction !== only)) continue;
      for (const [ns, rs] of compact) for (const pad of margins) {
        const result = await tryLayout(reserved, ns, rs, pad);
        if (result) return result;
      }
    }
  };
  // The snake is a whole-word LR layout. Snakes taller than the budget still
  // count when the canvas may grow, so they are returned for the expand pass.
  const snakePass = (wordFloor = longestWord): Promise<SnakeSearch> => {
    const known = search.snakes.get(wordFloor);
    if (known) return Promise.resolve(known);
    return searchSnake(wordFloor).then(result => { search.snakes.set(wordFloor, result); return result; });
  };
  const searchSnake = async (wordFloor: number): Promise<SnakeSearch> => {
    const tallSnakes: Candidate[] = [];
    for (let wrap = Math.min(labelWidth, Math.max(1, width - 4)); wrap >= Math.max(1, Math.min(wordFloor, width - 4)); wrap--) {
      for (const loopLabelWidth of loopWrapsFor("LR")) {
      const lr = measureGlyphGraph(graph, { ...options, direction: "LR", labelWidth: wrap, loopLabelWidth });
      for (const [, rs] of compact) {
        // A few tall snakes are all the expand pass needs, but a later candidate may still fit the requested height, so the search
        // goes on; routing is only spent on one whose rows could fit even with every gap at a single row.
        if (tallSnakes.length >= MAX_TALL_SNAKES && !((glyphDiagramSnakeLayout(lr, { width, gap: rs, margin, branchGap: 1, rowGap: 1 })?.height ?? Infinity) <= height)) continue;
        const snake = (rowGap: readonly number[], branchGap: readonly number[]) => {
          const raw = glyphDiagramSnakeLayout(lr, { width, gap: rs, margin, branchGap, rowGap });
          if (!raw || raw.width > width || !glyphDiagramHasRoutingClearance(raw)) return undefined;
          const candidate = { raw, adjusted: true, nodesep, ranksep: rs, margin };
          const result = attempt(candidate, width, Math.max(height, raw.height));
          return result.okay && !dropsEdgeLabel(result, options) ? { candidate, result } : undefined;
        };
        // The shortest uniform gaps that route, then each gap shrunk on its
        // own: one turning edge must not pad every other gap to its size.
        type Found = { readonly candidate: Candidate; readonly result: GlyphDiagramAttempt; readonly rowGaps: number[]; readonly branchGaps: number[] };
        // A graph with nothing hanging under its main path has no use for the branch gap, so only one value of it is searched.
        const branchless = (() => {
          const at = (b: number) => glyphDiagramSnakeLayout(lr, { width, gap: rs, margin, branchGap: b, rowGap: 3 })?.nodes.map(n => [n.x0, n.y0]);
          return JSON.stringify(at(3)) === JSON.stringify(at(4));
        })();
        // The first uniform gaps, from `floor` up, that route: more cannot make a snake shorter.
        const firstRouted = (floor: number): Found | undefined => {
          for (const [r, b] of snakeGaps(graph.edges.length, floor)) {
            if (branchless && b !== floor) continue;
            const rows = glyphDiagramSnakeLayout(lr, { width, gap: rs, margin, branchGap: b, rowGap: r })?.ledger.find(e => e.code === "layout-wrapped")?.detail?.rows as number | undefined;
            if (rows === undefined) continue;
            const here = snake(Array(rows).fill(r), Array(rows).fill(b));
            if (here) return { ...here, rowGaps: Array(rows).fill(r), branchGaps: Array(rows).fill(b) };
          }
        };
        // Gaps roomy enough for a loop's rows and the turn after them come first; the bare minimum is the fallback when those make the layout too tall.
        let found = loopRows ? firstRouted(3 + loopRows) : undefined;
        if (!found || found.candidate.raw.height > height) {
          const bare = firstRouted(3);
          if (bare && (!found || bare.candidate.raw.height <= height)) found = bare;
        }
        const rowGaps = found?.rowGaps ?? [], branchGaps = found?.branchGaps ?? [];
        if (!found) continue;
        let best: { readonly candidate: Candidate; readonly result: GlyphDiagramAttempt } = found;
        for (const gaps of branchless ? [rowGaps] : [rowGaps, branchGaps]) for (let i = 0; i < gaps.length; i++) {
          for (let g = 1; g < gaps[i]!; g++) {
            const trial = [...gaps]; trial[i] = g;
            const tighter = gaps === rowGaps ? snake(trial, branchGaps) : snake(rowGaps, trial);
            if (!tighter) continue;
            const [cells, bends] = routeShape(tighter.result), [beforeCells, beforeBends] = routeShape(best.result);
            if (cells <= beforeCells && bends <= beforeBends) { gaps[i] = g; best = tighter; break; }
          }
        }
        if (best.candidate.raw.height <= height) return { fit: best.result, tall: tallSnakes };
        if (options.overflow === "expand") tallSnakes.push(best.candidate);
      }
      }
    }
    return { tall: tallSnakes };
  };
  // Tightening is insufficient when protected port lanes or a return edge
  // consume a gap. Each additional connection can need its own separated lane.
  // Search the two axes independently: widening one must not waste the other.
  const clearance = GLYPH_DIAGRAM_ROUTE_SEPARATION + 2 * graph.edges.length;
  const maxNodeGap = Math.max(nodesep, clearance), maxRankGap = Math.max(ranksep, clearance);
  const repair = async (candidate: Candidate): Promise<Candidate[]> => {
    const next: Candidate[] = [];
    for (const [ns, rs] of [[candidate.nodesep + 1, candidate.ranksep], [candidate.nodesep, candidate.ranksep + 1]]) {
      if (ns > maxNodeGap || rs > maxRankGap) continue;
      const raw = await place(candidate.raw, ns, rs, candidate.margin);
      if (!raw) continue;
      next.push({ raw, adjusted: true, nodesep: ns, ranksep: rs, margin: candidate.margin });
    }
    return next;
  };
  // Widening a gap inside the viewport can clear a blocked route; candidates it
  // creates join the pool the final expand searches.
  const repairWithin = async (pool: Candidate[]): Promise<GlyphDiagramAttempt | undefined> => {
    const blocked = pool.filter(candidate => candidate.raw.width <= width && candidate.raw.height <= height);
    for (let i = 0; i < blocked.length; i++) {
      for (const candidate of await repair(blocked[i]!)) {
        candidates.push(candidate);
        // Increasing spacing outside a fixed viewport cannot rescue its overflow.
        if (candidate.raw.width > width || candidate.raw.height > height) continue;
        if (glyphDiagramHasRoutingClearance(candidate.raw)) {
          const result = attempt(candidate, width, height);
          if (result.okay) return result;
        }
        blocked.push(candidate);
      }
    }
    return undefined;
  };
  // Each direction is exhausted in whole words before the next is tried, the
  // authored one first: whole-word wraps, the snake (LR only), in-viewport
  // repair, then (when the canvas may grow) a taller layout at the same width.
  // A WIDER one does not beat cutting words in the other direction: widening
  // is the last resort below.
  for (const dir of directions) {
    const whole = await tryMeasured(wrap => wrap >= longestWord, dir);
    if (whole) return whole;
    const snake = dir === "LR" ? await snakePass() : { tall: [] as Candidate[] };
    if (snake.fit) return snake.fit;
    const pool = candidates.filter(candidate => candidate.raw.direction === dir);
    const repairedWhole = await repairWithin(pool);
    if (repairedWhole) return repairedWhole;
    if (options.overflow === "expand") {
      const best = await expand([...candidates.filter(candidate => candidate.raw.direction === dir), ...snake.tall], width);
      if (best) return best;
    }
    // An ordinary whole-word fit needs no extra punctuation candidates.
    // Otherwise punctuation breaks get the same opportunities before any
    // letter is cut, including the snake and a taller canvas.
    if (longestPiece < longestWord) {
      const start = candidates.length;
      const pieces = await tryMeasured(wrap => wrap >= longestPiece && wrap < longestWord, dir);
      if (pieces) return pieces;
      const snake = dir === "LR" ? await snakePass(longestPiece) : { tall: [] as Candidate[] };
      if (snake.fit) return snake.fit;
      const pool = candidates.slice(start);
      const repaired = await repairWithin(pool);
      if (repaired) return repaired;
      if (options.overflow === "expand") {
        const best = await expand([...pool, ...snake.tall], width);
        if (best) return best;
      }
    }
  }
  if (options.cutWords === false) return first;
  const wholeCount = candidates.length;
  const cut = await tryMeasured(wrap => wrap < longestPiece);
  if (cut) return cut;
  const repairedCut = await repairWithin(candidates.slice(wholeCount));
  if (repairedCut) return repairedCut;

  if (options.overflow === "expand") {
    const best = await expand(candidates);
    if (best) return best;
  }
  return first;

  // Preserve the available line width before adding rows: vertical panning
  // keeps each line readable without requiring sideways travel as well.
  async function expand(pool: Candidate[], maxCols = Infinity): Promise<GlyphDiagramAttempt | undefined> {
    const cost = (cols: number, rows: number) => [cols / width, rows / height] as const;
    const compare = (a: readonly [number, number], b: readonly [number, number]) => a[0] - b[0] || a[1] - b[1];
    const lowerBound = (candidate: Candidate) => cost(Math.max(width, candidate.raw.width), Math.max(height, candidate.raw.height));
    maxCols = Math.min(maxCols, search.maxWidth ?? Infinity);
    const maxRows = search.maxHeight ?? Infinity;
    const eligible = (candidate: Candidate) => candidate.raw.width <= maxCols && candidate.raw.height <= maxRows;
    const candidates = pool.filter(eligible);
    let best: GlyphDiagramAttempt | undefined;
    const probed: Candidate[] = [];
    const smallest = new Map<Candidate, GlyphDiagramAttempt>();
    // Repair internal spacing before spending routing work on exterior gutters.
    // A bounded probe prevents an impossible tight canvas from exhausting every gap.
    for (let probes = 0; candidates.length && probes < MAX_EXPAND_PROBES && search.work.expansionRoutes < MAX_EXPAND_ROUTING; probes++) {
      candidates.sort((a, b) => compare(lowerBound(a), lowerBound(b)));
      const candidate = candidates.shift()!;
      if (best && compare(lowerBound(candidate), cost(best.width, best.height)) >= 0) {
        candidates.unshift(candidate);
        break;
      }
      probed.push(candidate);
      if (glyphDiagramHasRoutingClearance(candidate.raw)) {
        const result = attempt(candidate, Math.max(width, candidate.raw.width), Math.max(height, candidate.raw.height), true);
        smallest.set(candidate, result);
        if (result.okay) best = result;
      }
      candidates.push(...(await repair(candidate)).filter(eligible));
    }
    if (probed.length === MAX_EXPAND_PROBES && candidates.length) search.ledger.push({
      code: "fit-search-limited", message: "Stopped expansion spacing search at its deterministic work limit.",
      detail: { stage: "expansion-spacing", candidateLimit: MAX_EXPAND_PROBES },
    });
    // A spacing fit is only an upper bound: an earlier candidate can route with
    // a cheaper exterior gutter. Replay in search order, including equal-cost
    // alternatives, so the spacing probe cannot change the accepted tie.
    const spacingBest = best;
    best = undefined;
    candidates.unshift(...probed);
    let routeProbes = 0, replayProbes = 0;
    while (candidates.length && routeProbes < MAX_GUTTER_PROBES && replayProbes < MAX_EXPAND_PROBES && search.work.expansionRoutes < MAX_EXPAND_ROUTING) {
      replayProbes++;
      candidates.sort((a, b) => compare(lowerBound(a), lowerBound(b)));
      const candidate = candidates.shift()!;
      if (best && compare(lowerBound(candidate), cost(best.width, best.height)) >= 0) break;
      let previousWidth = 0, previousHeight = 0;
      // Bounds include routing space, not just node boxes. Centering is exactly
      // the same for this probe and the final paint, so an accepted route is reused.
      const hasClearance = glyphDiagramHasRoutingClearance(candidate.raw);
      for (let gutter = 0; hasClearance && gutter <= clearance * 2 && routeProbes < MAX_GUTTER_PROBES && search.work.expansionRoutes < MAX_EXPAND_ROUTING; gutter++) {
        const cols = Math.min(maxCols, Math.max(width, candidate.raw.width + gutter)), rows = Math.max(height, candidate.raw.height + gutter);
        if (rows > maxRows) break;
        if (cols === previousWidth && rows === previousHeight) continue;
        previousWidth = cols; previousHeight = rows;
        if (best && compare(cost(cols, rows), cost(best.width, best.height)) >= 0) break;
        if (spacingBest && compare(cost(cols, rows), cost(spacingBest.width, spacingBest.height)) > 0) break;
        const cached = smallest.get(candidate);
        routeProbes++;
        const result = cached?.width === cols && cached.height === rows ? cached : attempt(candidate, cols, rows, true);
        if (result.okay) { best = result; break; }
      }
      candidates.push(...(await repair(candidate)).filter(eligible));
    }
    if (routeProbes === MAX_GUTTER_PROBES || (candidates.length && replayProbes === MAX_EXPAND_PROBES) || search.work.expansionRoutes === MAX_EXPAND_ROUTING) {
      search.ledger.push({ code: "fit-search-limited", message: "Stopped expansion gutter search at its deterministic work limit.",
        detail: { stage: "expansion-gutters", routeLimit: MAX_GUTTER_PROBES, candidateLimit: MAX_EXPAND_PROBES, totalRouteLimit: MAX_EXPAND_ROUTING } });
    }
    return best ?? spacingBest;
  }
}
