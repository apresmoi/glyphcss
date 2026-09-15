// A curated list of Hugging Face `graphs-datasets`-org graph datasets,
// shown as suggestions in the graph SEARCH box (`DiagramsDatasetSearchBox`)
// when the query is empty — the graph analogue of `ChartsWorkbench/datasets/
// remoteIndex.ts` (packet D5, AGENTS.md's "Diagrams" — mirrors "Charts"
// "Data layer"). No graph is vendored here; this is only a starting point
// for `lib/graphDatasetLoad.ts` to fetch fresh.
//
// Every id below was verified LIVE (2026-09-15) against
// `datasets-server.huggingface.co`'s `/splits` + `/rows` — a real HTTP
// round trip per id (row shape: `edge_index`/`num_nodes`, optionally
// `node_feat`/`edge_attr`/`y`), plus the Hub's own `/api/datasets/<id>`
// metadata for licence/description. Title, description and licence below
// are stated exactly as each dataset's own card states them — where a card
// carries no `license` key at all (AIDS), that is recorded as "not stated"
// rather than invented; where a card states its licence as literally
// "unknown" (MUTAG, ZINC, IMDB-BINARY), that word is kept verbatim.
//
// Three molecule datasets, two social ego-net datasets, one discussion-
// thread dataset and one actor-collaboration dataset — the exact spread
// packet D5's own brief named.
import type { DatasetHit } from "../../../lib/datasetSearch";

/** Datasets whose graphs read as chemical structures — `DiagramsWorkbench.tsx`
 *  reads this to decide whether a picked remote graph should default to the
 *  3D view (this file's own "View default" note below; see
 *  `docs/design/diagrams.md`'s "D5" section for the rendered comparison). */
export const DIAGRAMS_MOLECULE_GRAPH_REFS: ReadonlySet<string> = new Set([
  "graphs-datasets/MUTAG", "graphs-datasets/ZINC", "graphs-datasets/AIDS",
]);

export const DIAGRAMS_REMOTE_GRAPH_INDEX: readonly DatasetHit[] = [
  {
    id: "graphs-datasets/MUTAG", kind: "hf", ref: "graphs-datasets/MUTAG",
    title: "MUTAG",
    description: "187 nitroaromatic compounds, each graph a molecule labelled for mutagenicity on Salmonella typhimurium.",
    url: "https://huggingface.co/datasets/graphs-datasets/MUTAG", licence: "unknown",
  },
  {
    id: "graphs-datasets/ZINC", kind: "hf", ref: "graphs-datasets/ZINC",
    title: "ZINC",
    description: "220,011 commercially available drug-like molecules from the ZINC database, labelled with a constrained-solubility score.",
    url: "https://huggingface.co/datasets/graphs-datasets/ZINC", licence: "unknown",
  },
  {
    id: "graphs-datasets/AIDS", kind: "hf", ref: "graphs-datasets/AIDS",
    title: "AIDS",
    description: "Roughly 2,000 compounds checked for evidence of anti-HIV activity, one molecule graph per compound.",
    url: "https://huggingface.co/datasets/graphs-datasets/AIDS", licence: "not stated",
  },
  {
    id: "graphs-datasets/twitch_egos", kind: "hf", ref: "graphs-datasets/twitch_egos",
    title: "Twitch ego-nets",
    description: "Ego-networks of Twitch users who joined the partnership program in April 2018 — nodes are users, edges are friendships.",
    url: "https://huggingface.co/datasets/graphs-datasets/twitch_egos", licence: "gpl-3.0",
  },
  {
    id: "graphs-datasets/deezer_ego_nets", kind: "hf", ref: "graphs-datasets/deezer_ego_nets",
    title: "Deezer ego-nets",
    description: "Ego-networks of Eastern European Deezer users collected in February 2020 — nodes are users, edges are mutual follows.",
    url: "https://huggingface.co/datasets/graphs-datasets/deezer_ego_nets", licence: "gpl-3.0",
  },
  {
    id: "graphs-datasets/reddit_threads", kind: "hf", ref: "graphs-datasets/reddit_threads",
    title: "Reddit threads",
    description: "Discussion and non-discussion Reddit threads from May 2018 — nodes are participating users, edges are replies between them.",
    url: "https://huggingface.co/datasets/graphs-datasets/reddit_threads", licence: "gpl-3.0",
  },
  {
    id: "graphs-datasets/IMDB-BINARY", kind: "hf", ref: "graphs-datasets/IMDB-BINARY",
    title: "IMDb collaboration (binary)",
    description: "Ego-networks of 1,000 actors/actresses from Action and Romance films — an edge means two actors appeared in the same movie.",
    url: "https://huggingface.co/datasets/graphs-datasets/IMDB-BINARY", licence: "unknown",
  },
];
