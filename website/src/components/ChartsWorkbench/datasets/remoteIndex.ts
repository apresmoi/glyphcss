// A curated list of well-known public tabular Hugging Face datasets,
// shown as suggestions in the dataset SEARCH box (`ChartsDatasetSearchBox`)
// when the query is empty — so the feature works with zero typing, and is
// the offline fallback when the Hub's live search API is unreachable
// (AGENTS.md's "Charts" — "Data layer"). No rows are vendored here (that's
// `datasets/index.ts`'s job); this is only a starting point for
// `lib/datasetLoad.ts` to fetch fresh.
//
// Every id below was verified to actually resolve through
// `loadDatasetRows` (`datasets-server.huggingface.co`'s `/splits` +
// `/rows`) at the time this file was written — a real HTTP round trip per
// id, not merely "looks right by name". Most are `mstz/*` — a single
// Hugging Face author's mirror of the UCI Machine Learning Repository's
// classic small tabular datasets (titanic, wine, mushroom, …), which is
// where most of "well-known small public tabular dataset" naturally lives
// on the Hub; `scikit-learn/iris` (the maintainer's own canonical mirror)
// and `lukebarousse/data_jobs` round it out. If the Hub's live index is
// ever unreachable, this list — and the dataset each entry actually
// contains — still ages: an id that later moves/is deleted degrades
// through `lib/datasetLoad.ts`'s own structured error, exactly like a live
// search hit that goes stale between page loads.
import type { DatasetHit } from "../../../lib/datasetSearch";

export const CHARTS_REMOTE_DATASET_INDEX: readonly DatasetHit[] = [
  { id: "mstz/titanic", kind: "hf", ref: "mstz/titanic", title: "Titanic survival", description: "Passenger manifest and survival outcome from the 1912 sinking — the classic binary-classification dataset.", url: "https://huggingface.co/datasets/mstz/titanic" },
  { id: "mstz/wine", kind: "hf", ref: "mstz/wine", title: "Wine quality", description: "Physicochemical tests and a quality score for Portuguese \"Vinho Verde\" red/white wine samples.", url: "https://huggingface.co/datasets/mstz/wine" },
  { id: "mstz/heart", kind: "hf", ref: "mstz/heart", title: "Heart disease (Cleveland)", description: "Clinical measurements and a heart-disease diagnosis from the UCI Cleveland cohort.", url: "https://huggingface.co/datasets/mstz/heart" },
  { id: "mstz/heart_failure", kind: "hf", ref: "mstz/heart_failure", title: "Heart failure clinical records", description: "Follow-up clinical records for heart-failure patients, with a survival outcome.", url: "https://huggingface.co/datasets/mstz/heart_failure" },
  { id: "mstz/abalone", kind: "hf", ref: "mstz/abalone", title: "Abalone age", description: "Physical measurements of abalone shells used to predict age (ring count) without cutting the shell.", url: "https://huggingface.co/datasets/mstz/abalone" },
  { id: "mstz/car", kind: "hf", ref: "mstz/car", title: "Car evaluation", description: "Categorical car attributes (price, safety, capacity) and an overall acceptability rating.", url: "https://huggingface.co/datasets/mstz/car" },
  { id: "mstz/mushroom", kind: "hf", ref: "mstz/mushroom", title: "Mushroom edibility", description: "Physical characteristics of mushroom species labelled edible or poisonous.", url: "https://huggingface.co/datasets/mstz/mushroom" },
  { id: "mstz/glass", kind: "hf", ref: "mstz/glass", title: "Glass identification", description: "Refractive index and oxide content used to classify glass fragments by type — a forensic-science classic.", url: "https://huggingface.co/datasets/mstz/glass" },
  { id: "mstz/seeds", kind: "hf", ref: "mstz/seeds", title: "Wheat seed measurements", description: "Geometric measurements of wheat kernels from three varieties, via soft X-ray imaging.", url: "https://huggingface.co/datasets/mstz/seeds" },
  { id: "mstz/pima", kind: "hf", ref: "mstz/pima", title: "Pima Indians diabetes", description: "Diagnostic measurements for female Pima Indian patients used to predict diabetes onset.", url: "https://huggingface.co/datasets/mstz/pima" },
  { id: "mstz/bank", kind: "hf", ref: "mstz/bank", title: "Bank marketing", description: "Direct-marketing phone-campaign records for a Portuguese bank, with a term-deposit subscription outcome.", url: "https://huggingface.co/datasets/mstz/bank" },
  { id: "mstz/blood", kind: "hf", ref: "mstz/blood", title: "Blood transfusion", description: "Blood-donation recency/frequency records and whether a donor gave again.", url: "https://huggingface.co/datasets/mstz/blood" },
  { id: "mstz/breast", kind: "hf", ref: "mstz/breast", title: "Breast cancer (Wisconsin)", description: "Cell-nuclei measurements from breast-mass biopsies, labelled benign or malignant.", url: "https://huggingface.co/datasets/mstz/breast" },
  { id: "mstz/german", kind: "hf", ref: "mstz/german", title: "German credit risk", description: "Loan-applicant attributes and a good/bad credit-risk classification.", url: "https://huggingface.co/datasets/mstz/german" },
  { id: "mstz/contraceptive", kind: "hf", ref: "mstz/contraceptive", title: "Contraceptive method choice", description: "Demographic survey data used to predict a married woman's contraceptive method choice.", url: "https://huggingface.co/datasets/mstz/contraceptive" },
  { id: "mstz/haberman", kind: "hf", ref: "mstz/haberman", title: "Haberman's survival", description: "Breast-cancer surgery patients' age, year of operation and node count, with a 5-year survival outcome.", url: "https://huggingface.co/datasets/mstz/haberman" },
  { id: "mstz/liver", kind: "hf", ref: "mstz/liver", title: "Liver disorders (BUPA)", description: "Blood-test results used to predict liver disorder related to alcohol consumption.", url: "https://huggingface.co/datasets/mstz/liver" },
  { id: "mstz/spambase", kind: "hf", ref: "mstz/spambase", title: "Spambase", description: "Word/character frequency features from email messages, labelled spam or not.", url: "https://huggingface.co/datasets/mstz/spambase" },
  { id: "mstz/sonar", kind: "hf", ref: "mstz/sonar", title: "Sonar: mines vs. rocks", description: "Sonar-return signal strengths at various angles, classified as a metal cylinder or a rock.", url: "https://huggingface.co/datasets/mstz/sonar" },
  { id: "mstz/vertebral_column", kind: "hf", ref: "mstz/vertebral_column", title: "Vertebral column pathology", description: "Biomechanical spine measurements used to classify orthopaedic pathology.", url: "https://huggingface.co/datasets/mstz/vertebral_column" },
  { id: "mstz/tic_tac_toe", kind: "hf", ref: "mstz/tic_tac_toe", title: "Tic-tac-toe endgame", description: "Every possible tic-tac-toe board endgame, labelled whether \"x\" won.", url: "https://huggingface.co/datasets/mstz/tic_tac_toe" },
  { id: "mstz/segment", kind: "hf", ref: "mstz/segment", title: "Image segmentation", description: "Statistical/shape features of 3x3 image patches drawn from seven outdoor scene classes.", url: "https://huggingface.co/datasets/mstz/segment" },
  { id: "mstz/waveform_noise_v1", kind: "hf", ref: "mstz/waveform_noise_v1", title: "Waveform (with noise)", description: "Synthetic three-class waveform data with added noise attributes — a classic signal-classification benchmark.", url: "https://huggingface.co/datasets/mstz/waveform_noise_v1" },
  { id: "mstz/steel_plates", kind: "hf", ref: "mstz/steel_plates", title: "Steel plates faults", description: "Geometric and luminosity measurements of steel-plate surface faults, by fault type.", url: "https://huggingface.co/datasets/mstz/steel_plates" },
  { id: "mstz/electricity", kind: "hf", ref: "mstz/electricity", title: "Electricity market pricing", description: "Half-hourly Australian electricity market records, labelled by price movement relative to a moving average.", url: "https://huggingface.co/datasets/mstz/electricity" },
  { id: "mstz/phoneme", kind: "hf", ref: "mstz/phoneme", title: "Phoneme (nasal vs. oral)", description: "Speech-signal amplitude features used to distinguish nasal from oral vowel sounds.", url: "https://huggingface.co/datasets/mstz/phoneme" },
  { id: "mstz/student_performance", kind: "hf", ref: "mstz/student_performance", title: "Student performance", description: "Demographic and study-habit attributes for secondary-school students, with final grades.", url: "https://huggingface.co/datasets/mstz/student_performance" },
  { id: "mstz/compas", kind: "hf", ref: "mstz/compas", title: "COMPAS recidivism", description: "Criminal-history and demographic records used in the widely studied COMPAS recidivism-risk analysis.", url: "https://huggingface.co/datasets/mstz/compas" },
  { id: "mstz/australian_credit", kind: "hf", ref: "mstz/australian_credit", title: "Australian credit approval", description: "Anonymised credit-card application attributes with an approval outcome.", url: "https://huggingface.co/datasets/mstz/australian_credit" },
  { id: "lukebarousse/data_jobs", kind: "hf", ref: "lukebarousse/data_jobs", title: "Data job postings", description: "Real data-analyst/scientist/engineer job postings — title, company, location, salary and required skills.", url: "https://huggingface.co/datasets/lukebarousse/data_jobs" },
];
