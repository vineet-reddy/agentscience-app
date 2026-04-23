/**
 * Curated pool of editorial suggestion questions (Layer 1).
 *
 * This is intentionally hand-maintained, not auto-generated. Each entry is a
 * complete question the user could run as-is: a concrete hypothesis tied to
 * one or more known datasets. The right-rail source tag is what appears next
 * to the question in the empty state (IBM Plex Mono on the right edge).
 *
 * Rotation policy: filter by dataset connectivity first, then by field
 * overlap, then pick 4 with a bit of variation so a returning user doesn't
 * see the same 4 on every visit. See `pickSuggestedQuestions` for the
 * tie-breaking.
 *
 * Refresh cadence: treat this file as content, not code. Drop stale
 * questions monthly; add new ones whenever the registry gains a provider.
 */
import type { FieldTag } from "../onboardingCatalog";

export type Difficulty = "intro" | "standard" | "deep";

export interface SuggestedQuestion {
  id: string;
  question: string;
  /** The short right-side tag shown in IBM Plex Mono. */
  sourceTag: string;
  /**
   * Data-interest ids from onboardingCatalog that should be in the user's
   * `data_interests` for this question to surface. Empty means "generic" and
   * always eligible.
   */
  requiredDataInterests: ReadonlyArray<string>;
  fields: ReadonlyArray<FieldTag>;
  difficulty: Difficulty;
}

export const CURATED_SUGGESTED_QUESTIONS: ReadonlyArray<SuggestedQuestion> = [
  // ─── Oncology ───────────────────────────────────────────────────────
  {
    id: "onc-01",
    question:
      "Are there tumor-specific, normal-tissue-sparing targets shared across pediatric solid tumors?",
    sourceTag: "OpenPBTA",
    requiredDataInterests: [],
    fields: ["oncology"],
    difficulty: "deep",
  },
  {
    id: "onc-02",
    question: "Which DepMap 24Q2 dependencies are uniquely vulnerable in high-risk B-ALL?",
    sourceTag: "DepMap",
    requiredDataInterests: ["depmap"],
    fields: ["oncology"],
    difficulty: "standard",
  },
  {
    id: "onc-03",
    question: "Has 5-year pediatric cancer survival meaningfully improved since 2015?",
    sourceTag: "SEER",
    requiredDataInterests: ["seer"],
    fields: ["oncology", "clinical-epidemiology"],
    difficulty: "standard",
  },
  {
    id: "onc-04",
    question: "Replicate the TCR clonality / checkpoint-response correlation across cBioPortal studies.",
    sourceTag: "cBioPortal",
    requiredDataInterests: ["cbioportal"],
    fields: ["oncology", "immunology"],
    difficulty: "deep",
  },
  {
    id: "onc-05",
    question: "Which TCGA subtypes have the strongest WNT/β-catenin dependency signature?",
    sourceTag: "TCGA",
    requiredDataInterests: ["tcga"],
    fields: ["oncology"],
    difficulty: "standard",
  },
  {
    id: "onc-06",
    question:
      "Across GEO, which pediatric tumor cohorts show shared epigenetic fingerprints with AT/RT?",
    sourceTag: "GEO",
    requiredDataInterests: ["geo-sra"],
    fields: ["oncology", "genomics"],
    difficulty: "deep",
  },
  {
    id: "onc-07",
    question: "Summarize active pediatric CAR-T trials that allow CNS involvement.",
    sourceTag: "ClinicalTrials.gov",
    requiredDataInterests: ["clinicaltrials"],
    fields: ["oncology", "immunology"],
    difficulty: "intro",
  },
  {
    id: "onc-08",
    question: "Rank St. Jude Cloud cohorts by RNA-seq availability for rare sarcomas.",
    sourceTag: "St. Jude Cloud",
    requiredDataInterests: ["stjude"],
    fields: ["oncology"],
    difficulty: "standard",
  },

  // ─── Genomics / Bioinformatics ──────────────────────────────────────
  {
    id: "gen-01",
    question: "Which gnomAD v4 loss-of-function genes are depleted beyond expected in East Asians?",
    sourceTag: "gnomAD",
    requiredDataInterests: ["gnomad"],
    fields: ["genomics", "bioinformatics"],
    difficulty: "deep",
  },
  {
    id: "gen-02",
    question: "Cross-reference Ensembl annotations with recent GTEx eQTLs for tissue-specific splicing.",
    sourceTag: "Ensembl",
    requiredDataInterests: ["ensembl"],
    fields: ["genomics", "bioinformatics"],
    difficulty: "standard",
  },
  {
    id: "gen-03",
    question: "Fetch the 10 most-downloaded GEO single-cell datasets from the last 90 days.",
    sourceTag: "GEO",
    requiredDataInterests: ["geo-sra"],
    fields: ["genomics", "bioinformatics"],
    difficulty: "intro",
  },
  {
    id: "gen-04",
    question: "Using UK Biobank, estimate heritability of resting heart rate stratified by ancestry.",
    sourceTag: "UK Biobank",
    requiredDataInterests: ["uk-biobank"],
    fields: ["genomics", "clinical-epidemiology"],
    difficulty: "deep",
  },
  {
    id: "gen-05",
    question: "Which ENCODE cCREs overlap GWAS hits for inflammatory bowel disease?",
    sourceTag: "ENCODE",
    requiredDataInterests: ["encode"],
    fields: ["genomics", "bioinformatics"],
    difficulty: "standard",
  },
  {
    id: "gen-06",
    question: "Re-run a tissue deconvolution on GEO GSE-style bulk RNA-seq using CIBERSORTx defaults.",
    sourceTag: "GEO",
    requiredDataInterests: ["geo-sra"],
    fields: ["bioinformatics"],
    difficulty: "standard",
  },
  {
    id: "gen-07",
    question: "Pull UniProt domain annotations for the top 50 oncology drug targets.",
    sourceTag: "UniProt",
    requiredDataInterests: ["uniprot"],
    fields: ["bioinformatics", "drug-discovery"],
    difficulty: "intro",
  },
  {
    id: "gen-08",
    question: "Summarize KEGG pathway enrichment across the latest TCGA proteomics cohort.",
    sourceTag: "KEGG",
    requiredDataInterests: ["kegg"],
    fields: ["bioinformatics", "oncology"],
    difficulty: "standard",
  },

  // ─── Neuroscience ───────────────────────────────────────────────────
  {
    id: "nsc-01",
    question: "Compare cortical thickness trajectories in ABCD across socioeconomic strata.",
    sourceTag: "ABCD",
    requiredDataInterests: ["abcd"],
    fields: ["neuroscience"],
    difficulty: "deep",
  },
  {
    id: "nsc-02",
    question: "Which OpenNeuro fMRI datasets include both task and rest data for aphasia cohorts?",
    sourceTag: "OpenNeuro",
    requiredDataInterests: ["openneuro"],
    fields: ["neuroscience"],
    difficulty: "intro",
  },
  {
    id: "nsc-03",
    question: "Using HCP data, benchmark structural connectome stability across scanners.",
    sourceTag: "HCP",
    requiredDataInterests: ["hcp"],
    fields: ["neuroscience"],
    difficulty: "deep",
  },
  {
    id: "nsc-04",
    question: "Do ADNI amyloid PET trajectories differ between APOE-e4 carriers at the same baseline?",
    sourceTag: "ADNI",
    requiredDataInterests: ["adni"],
    fields: ["neuroscience"],
    difficulty: "standard",
  },
  {
    id: "nsc-05",
    question: "Map Allen Brain Atlas ISH expression for RELN across cortical layers.",
    sourceTag: "Allen Brain",
    requiredDataInterests: ["allen-brain"],
    fields: ["neuroscience"],
    difficulty: "standard",
  },
  {
    id: "nsc-06",
    question: "Rank UK Biobank brain-MRI IDPs by effect size on reaction time.",
    sourceTag: "UKB Imaging",
    requiredDataInterests: ["ukb-imaging", "uk-biobank"],
    fields: ["neuroscience"],
    difficulty: "standard",
  },

  // ─── Immunology ─────────────────────────────────────────────────────
  {
    id: "imm-01",
    question: "Compare IEDB T-cell epitopes for HLA-A*02:01 across respiratory pathogens.",
    sourceTag: "IEDB",
    requiredDataInterests: ["iedb"],
    fields: ["immunology"],
    difficulty: "standard",
  },
  {
    id: "imm-02",
    question:
      "Using ImmPort, pull vaccine trials that measured both serology and single-cell transcriptomics.",
    sourceTag: "ImmPort",
    requiredDataInterests: ["immport"],
    fields: ["immunology"],
    difficulty: "standard",
  },
  {
    id: "imm-03",
    question: "Which Open Targets associations for IL-23 have passed Phase 2 since 2023?",
    sourceTag: "Open Targets",
    requiredDataInterests: ["opentargets"],
    fields: ["immunology", "drug-discovery"],
    difficulty: "standard",
  },
  {
    id: "imm-04",
    question: "List 10x Immune Cell Atlas donors sequenced with both 5' and TCR enrichment.",
    sourceTag: "10x",
    requiredDataInterests: ["10x-immune"],
    fields: ["immunology"],
    difficulty: "intro",
  },

  // ─── Drug Discovery / Chemistry ─────────────────────────────────────
  {
    id: "drg-01",
    question: "Pull ChEMBL actives against PI3K-δ with selectivity over PI3K-α above 10x.",
    sourceTag: "ChEMBL",
    requiredDataInterests: ["chembl"],
    fields: ["drug-discovery"],
    difficulty: "standard",
  },
  {
    id: "drg-02",
    question: "Which PubChem assays report IC50 data for KRAS G12C covalent binders?",
    sourceTag: "PubChem",
    requiredDataInterests: ["pubchem"],
    fields: ["drug-discovery"],
    difficulty: "standard",
  },
  {
    id: "drg-03",
    question: "Build a DrugBank table of approved BTK inhibitors with dosing and target residues.",
    sourceTag: "DrugBank",
    requiredDataInterests: ["drugbank"],
    fields: ["drug-discovery"],
    difficulty: "intro",
  },
  {
    id: "drg-04",
    question: "Identify PDB structures of GPCRs bound to allosteric modulators, published post-2022.",
    sourceTag: "PDB",
    requiredDataInterests: ["pdb"],
    fields: ["drug-discovery", "bioinformatics"],
    difficulty: "standard",
  },
  {
    id: "drg-05",
    question: "From ZINC22, sample drug-like fragments (MW < 300) that match PAINS-free filters.",
    sourceTag: "ZINC",
    requiredDataInterests: ["zinc"],
    fields: ["drug-discovery"],
    difficulty: "standard",
  },

  // ─── Clinical Epidemiology ──────────────────────────────────────────
  {
    id: "cep-01",
    question: "Compare NHANES 2017–2020 fasting glucose trends across BMI quartiles.",
    sourceTag: "NHANES",
    requiredDataInterests: ["nhanes"],
    fields: ["clinical-epidemiology"],
    difficulty: "standard",
  },
  {
    id: "cep-02",
    question: "Using CDC WONDER, chart county-level opioid mortality rates post-2020.",
    sourceTag: "CDC WONDER",
    requiredDataInterests: ["cdc-wonder"],
    fields: ["clinical-epidemiology"],
    difficulty: "intro",
  },
  {
    id: "cep-03",
    question: "Replicate a MIMIC-IV sepsis early-warning score and check calibration.",
    sourceTag: "MIMIC-IV",
    requiredDataInterests: ["mimic"],
    fields: ["clinical-epidemiology", "machine-learning"],
    difficulty: "deep",
  },
  {
    id: "cep-04",
    question: "Which clinical trials started in 2025 include digital biomarker endpoints?",
    sourceTag: "ClinicalTrials.gov",
    requiredDataInterests: ["clinicaltrials"],
    fields: ["clinical-epidemiology"],
    difficulty: "intro",
  },
  {
    id: "cep-05",
    question: "Pull WHO GHO time series for childhood immunization coverage since 2010.",
    sourceTag: "WHO GHO",
    requiredDataInterests: ["who"],
    fields: ["clinical-epidemiology"],
    difficulty: "intro",
  },

  // ─── Ecology ────────────────────────────────────────────────────────
  {
    id: "eco-01",
    question: "Chart GBIF occurrence records for Plasmodium vectors by latitude band.",
    sourceTag: "GBIF",
    requiredDataInterests: ["gbif"],
    fields: ["ecology"],
    difficulty: "standard",
  },
  {
    id: "eco-02",
    question: "Compare eBird spring arrival dates in the Northeast US over the last 10 years.",
    sourceTag: "eBird",
    requiredDataInterests: ["ebird"],
    fields: ["ecology", "climate"],
    difficulty: "standard",
  },
  {
    id: "eco-03",
    question: "Rank NEON sites by above-ground biomass change since 2018.",
    sourceTag: "NEON",
    requiredDataInterests: ["neon"],
    fields: ["ecology"],
    difficulty: "standard",
  },
  {
    id: "eco-04",
    question: "Pull Movebank tracks for wolves reintroduced to the Colorado front range.",
    sourceTag: "Movebank",
    requiredDataInterests: ["movebank"],
    fields: ["ecology"],
    difficulty: "intro",
  },
  {
    id: "eco-05",
    question: "Summarize iNaturalist records for invasive plants in the Pacific Northwest, 2024.",
    sourceTag: "iNaturalist",
    requiredDataInterests: ["inaturalist"],
    fields: ["ecology"],
    difficulty: "intro",
  },

  // ─── Physics ────────────────────────────────────────────────────────
  {
    id: "phy-01",
    question: "From HEPData, fetch CMS and ATLAS Higgs-to-tau-tau cross-sections and compare.",
    sourceTag: "HEPData",
    requiredDataInterests: ["hepdata"],
    fields: ["physics"],
    difficulty: "standard",
  },
  {
    id: "phy-02",
    question: "List CERN Open Data runs usable for top-quark mass reconstruction in Jupyter.",
    sourceTag: "CERN OD",
    requiredDataInterests: ["cern-opendata"],
    fields: ["physics"],
    difficulty: "deep",
  },
  {
    id: "phy-03",
    question: "Plot LIGO O4 detection rates by chirp mass to date.",
    sourceTag: "LIGO",
    requiredDataInterests: ["ligo"],
    fields: ["physics"],
    difficulty: "standard",
  },
  {
    id: "phy-04",
    question: "Summarize MAST observations of TRAPPIST-1 from the last year.",
    sourceTag: "MAST",
    requiredDataInterests: ["mast"],
    fields: ["physics"],
    difficulty: "intro",
  },
  {
    id: "phy-05",
    question: "Pull top-cited arXiv hep-th preprints of 2026 and cluster by title embedding.",
    sourceTag: "arXiv",
    requiredDataInterests: ["arxiv"],
    fields: ["physics", "machine-learning"],
    difficulty: "standard",
  },

  // ─── Materials Science ──────────────────────────────────────────────
  {
    id: "mat-01",
    question: "Rank Materials Project candidates for solid-state Li-ion electrolytes by stability.",
    sourceTag: "MP",
    requiredDataInterests: ["materials-project"],
    fields: ["materials-science"],
    difficulty: "standard",
  },
  {
    id: "mat-02",
    question: "From OQMD, pull formation energies of ternary oxides with Cu + rare-earth metals.",
    sourceTag: "OQMD",
    requiredDataInterests: ["oqmd"],
    fields: ["materials-science"],
    difficulty: "standard",
  },
  {
    id: "mat-03",
    question: "NOMAD entries: which perovskite compositions have measured band gaps > 2.5 eV?",
    sourceTag: "NOMAD",
    requiredDataInterests: ["nomad"],
    fields: ["materials-science"],
    difficulty: "standard",
  },
  {
    id: "mat-04",
    question: "Using AFLOW, compare elastic moduli across MAX-phase carbides.",
    sourceTag: "AFLOW",
    requiredDataInterests: ["aflow"],
    fields: ["materials-science"],
    difficulty: "deep",
  },

  // ─── Economics ──────────────────────────────────────────────────────
  {
    id: "eco-econ-01",
    question: "Compare FRED yield-curve inversions against subsequent GDP contractions since 1980.",
    sourceTag: "FRED",
    requiredDataInterests: ["fred"],
    fields: ["economics"],
    difficulty: "standard",
  },
  {
    id: "eco-econ-02",
    question:
      "From World Bank WDI, does primary-school completion predict female labor participation at t+10?",
    sourceTag: "World Bank",
    requiredDataInterests: ["world-bank"],
    fields: ["economics"],
    difficulty: "standard",
  },
  {
    id: "eco-econ-03",
    question: "BLS CPI-U components: which categories drove the 2023 disinflation?",
    sourceTag: "BLS",
    requiredDataInterests: ["bls"],
    fields: ["economics"],
    difficulty: "intro",
  },
  {
    id: "eco-econ-04",
    question: "Using IPUMS USA, replicate the gender wage gap decomposition by industry, 2000–2020.",
    sourceTag: "IPUMS",
    requiredDataInterests: ["ipums"],
    fields: ["economics"],
    difficulty: "deep",
  },
  {
    id: "eco-econ-05",
    question: "OECD productivity gap between manufacturing and services, 2010–2024.",
    sourceTag: "OECD",
    requiredDataInterests: ["oecd"],
    fields: ["economics"],
    difficulty: "standard",
  },

  // ─── Machine Learning ───────────────────────────────────────────────
  {
    id: "ml-01",
    question: "Benchmark the top 5 Hugging Face text-embedding models on MTEB-Lite.",
    sourceTag: "Hugging Face",
    requiredDataInterests: ["huggingface"],
    fields: ["machine-learning"],
    difficulty: "standard",
  },
  {
    id: "ml-02",
    question: "Which Kaggle competitions from 2024 used time-series data with > 1M rows?",
    sourceTag: "Kaggle",
    requiredDataInterests: ["kaggle"],
    fields: ["machine-learning"],
    difficulty: "intro",
  },
  {
    id: "ml-03",
    question: "Replicate OpenML-CC18 baseline scores and chart hardest-to-classify tasks.",
    sourceTag: "OpenML",
    requiredDataInterests: ["openml"],
    fields: ["machine-learning"],
    difficulty: "deep",
  },
  {
    id: "ml-04",
    question: "From Papers with Code, chart ImageNet top-1 improvements by year since 2020.",
    sourceTag: "PWC",
    requiredDataInterests: ["papers-with-code"],
    fields: ["machine-learning"],
    difficulty: "intro",
  },
  {
    id: "ml-05",
    question: "Audit arXiv cs.LG abstracts for rising topic keywords over the past 6 months.",
    sourceTag: "arXiv",
    requiredDataInterests: ["arxiv"],
    fields: ["machine-learning"],
    difficulty: "standard",
  },

  // ─── Climate ────────────────────────────────────────────────────────
  {
    id: "cli-01",
    question: "Pull ERA5 2-m temperature trends for major metro areas, 1994–2024.",
    sourceTag: "ERA5",
    requiredDataInterests: ["era5"],
    fields: ["climate"],
    difficulty: "standard",
  },
  {
    id: "cli-02",
    question: "Compare NASA GISS vs Berkeley Earth surface temperature anomalies.",
    sourceTag: "GISS",
    requiredDataInterests: ["nasa-giss", "berkeley-earth"],
    fields: ["climate"],
    difficulty: "standard",
  },
  {
    id: "cli-03",
    question: "From CMIP6, rank models by Arctic amplification magnitude under SSP2-4.5.",
    sourceTag: "CMIP6",
    requiredDataInterests: ["cmip6"],
    fields: ["climate"],
    difficulty: "deep",
  },
  {
    id: "cli-04",
    question: "Chart NOAA ocean-heat-content anomalies, 0–2000 m, since 2005.",
    sourceTag: "NOAA",
    requiredDataInterests: ["noaa"],
    fields: ["climate"],
    difficulty: "standard",
  },
  {
    id: "cli-05",
    question: "Summarize IPCC AR6 WG1 confidence language by chapter, normalized per 1k words.",
    sourceTag: "IPCC",
    requiredDataInterests: ["ipcc"],
    fields: ["climate"],
    difficulty: "intro",
  },

  // ─── Generic / cross-field ──────────────────────────────────────────
  {
    id: "gen-fb-01",
    question: "Survey the last 30 days of arXiv for papers pairing LLMs with dataset curation.",
    sourceTag: "arXiv",
    requiredDataInterests: ["arxiv"],
    fields: ["machine-learning", "other"],
    difficulty: "intro",
  },
  {
    id: "gen-fb-02",
    question: "Find Zenodo-hosted datasets released in 2026 with > 500 downloads.",
    sourceTag: "Zenodo",
    requiredDataInterests: ["zenodo"],
    fields: ["other"],
    difficulty: "intro",
  },
  {
    id: "gen-fb-03",
    question:
      "Compare Figshare vs Dryad upload volumes by discipline; surface fields most reliant on each.",
    sourceTag: "Figshare",
    requiredDataInterests: ["figshare", "dryad"],
    fields: ["other"],
    difficulty: "standard",
  },
  {
    id: "gen-fb-04",
    question: "Sketch a literature map for sub-seasonal climate forecasting, last 5 years.",
    sourceTag: "arXiv",
    requiredDataInterests: ["arxiv"],
    fields: ["climate", "machine-learning"],
    difficulty: "standard",
  },
  {
    id: "gen-fb-05",
    question: "Which datasets appear in the most replications of 'attention is all you need'?",
    sourceTag: "Papers with Code",
    requiredDataInterests: ["papers-with-code"],
    fields: ["machine-learning"],
    difficulty: "standard",
  },
  {
    id: "gen-fb-06",
    question: "Plot OECD vs World Bank female labor participation, 2010–2024.",
    sourceTag: "OECD",
    requiredDataInterests: ["oecd", "world-bank"],
    fields: ["economics"],
    difficulty: "intro",
  },
  {
    id: "gen-fb-07",
    question: "Draft a short paper comparing two open benchmarks of your choice.",
    sourceTag: "Hugging Face",
    requiredDataInterests: [],
    fields: [],
    difficulty: "intro",
  },
  {
    id: "gen-fb-08",
    question: "Summarize the 5 most-cited preprints from your field this month.",
    sourceTag: "arXiv",
    requiredDataInterests: [],
    fields: [],
    difficulty: "intro",
  },
  {
    id: "gen-fb-09",
    question: "Identify a dataset I haven't used that fits my last research question.",
    sourceTag: "Registry",
    requiredDataInterests: [],
    fields: [],
    difficulty: "intro",
  },
  {
    id: "gen-fb-10",
    question: "Write a literature review on a topic and flag 3 open questions worth investigating.",
    sourceTag: "arXiv",
    requiredDataInterests: [],
    fields: [],
    difficulty: "standard",
  },
];

export interface PickSuggestedQuestionsInput {
  /** User's onboarding field selection (may be empty). */
  fields: ReadonlyArray<FieldTag>;
  /** User's onboarding data_interests (may be empty). */
  dataInterests: ReadonlyArray<string>;
  /**
   * Slugs of datasets and providers the user has actually connected in their
   * workspace (auto-connected at onboarding + anything they later added).
   * Used as a harder filter than field overlap.
   */
  connectedDataInterests: ReadonlyArray<string>;
  /**
   * Number of times the empty state has already been rendered for this
   * session. Nudges rotation so a user who comes back doesn't see the same
   * four suggestions on visit 2.
   */
  renderSalt?: number;
  /** How many questions to return. Default 4, per spec. */
  count?: number;
}

/**
 * Layer 1 selection.
 *
 * Filtering order:
 *   1) Keep questions whose required datasets are all in the user's
 *      connected set (or questions with no required datasets).
 *   2) Prefer questions that overlap the user's field tags.
 *   3) If fewer than `count` survive, backfill from the broader pool,
 *      preferring field-matched questions before generic ones.
 *   4) If the user has no field at all, deliberately diversify across
 *      four different domains so the sampler feels wide-angle.
 *
 * The rotation salt nudges tie-breaks so the same 4 don't appear on every
 * visit. This is deterministic per session, not random: different users who
 * happen to share a profile see the same surface on visit N.
 */
export function pickSuggestedQuestions(
  input: PickSuggestedQuestionsInput,
): ReadonlyArray<SuggestedQuestion> {
  const count = input.count ?? 4;
  const salt = input.renderSalt ?? 0;
  const connectedSet = new Set(input.connectedDataInterests);
  const fieldSet = new Set(input.fields);

  const eligibleByConnection = CURATED_SUGGESTED_QUESTIONS.filter((q) => {
    if (q.requiredDataInterests.length === 0) return true;
    return q.requiredDataInterests.every((id) => connectedSet.has(id));
  });

  const overlapsField = (q: SuggestedQuestion): boolean =>
    q.fields.some((field) => fieldSet.has(field));

  const rotate = <T,>(arr: ReadonlyArray<T>): T[] => {
    if (arr.length === 0) return [];
    const offset = Math.abs(salt) % arr.length;
    return [...arr.slice(offset), ...arr.slice(0, offset)];
  };

  if (fieldSet.size === 0) {
    // No field tag → diverse sampler.
    return diversifyByField(rotate(eligibleByConnection), count);
  }

  const fieldMatched = rotate(eligibleByConnection.filter(overlapsField));
  if (fieldMatched.length >= count) {
    return fieldMatched.slice(0, count);
  }

  const fallback = rotate(
    eligibleByConnection.filter((q) => !overlapsField(q)),
  );
  const broad = [...fieldMatched, ...fallback];
  if (broad.length >= count) {
    return broad.slice(0, count);
  }

  // Exhausted the connected-filtered list. Dip into the entire pool.
  const remaining = rotate(
    CURATED_SUGGESTED_QUESTIONS.filter(
      (q) => !broad.some((entry) => entry.id === q.id),
    ),
  );
  return [...broad, ...remaining].slice(0, count);
}

function diversifyByField(
  pool: ReadonlyArray<SuggestedQuestion>,
  count: number,
): ReadonlyArray<SuggestedQuestion> {
  const picked: SuggestedQuestion[] = [];
  const usedFields = new Set<FieldTag | "__none__">();
  for (const question of pool) {
    if (picked.length >= count) break;
    const keys: Array<FieldTag | "__none__"> =
      question.fields.length === 0 ? ["__none__"] : [...question.fields];
    if (keys.some((k) => usedFields.has(k))) continue;
    picked.push(question);
    keys.forEach((k) => usedFields.add(k));
  }
  if (picked.length >= count) return picked;
  for (const question of pool) {
    if (picked.length >= count) break;
    if (picked.some((entry) => entry.id === question.id)) continue;
    picked.push(question);
  }
  return picked;
}
