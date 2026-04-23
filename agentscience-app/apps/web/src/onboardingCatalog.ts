/**
 * Onboarding taxonomy: the 12 to 15 field chips shown in question 1, and the
 * data-source chips shown in question 2 once a field is picked.
 *
 * Data-source chips deliberately conflate two things:
 *   - `slug` (when non-null): a dataset or provider in the live registry that
 *     can be auto-connected for the user's first thread (@dataset:/@provider:).
 *   - Text-only entries ("my own lab data", "other"): interests we capture
 *     but cannot pre-connect. Stored verbatim on the profile so ranking can
 *     still use them as signal; the workspace doesn't pretend a connection
 *     exists.
 *
 * Keep this list small and curated. It's editorial, not a taxonomy dump.
 */

export const FIELD_TAGS = [
  "oncology",
  "genomics",
  "neuroscience",
  "immunology",
  "drug-discovery",
  "clinical-epidemiology",
  "ecology",
  "physics",
  "materials-science",
  "economics",
  "machine-learning",
  "bioinformatics",
  "climate",
  "other",
] as const;

export type FieldTag = (typeof FIELD_TAGS)[number];

export interface FieldDefinition {
  tag: FieldTag;
  label: string;
}

export const FIELD_DEFINITIONS: ReadonlyArray<FieldDefinition> = [
  { tag: "oncology", label: "Oncology" },
  { tag: "genomics", label: "Genomics" },
  { tag: "neuroscience", label: "Neuroscience" },
  { tag: "immunology", label: "Immunology" },
  { tag: "drug-discovery", label: "Drug Discovery / Chemistry" },
  { tag: "clinical-epidemiology", label: "Clinical Epidemiology" },
  { tag: "ecology", label: "Ecology" },
  { tag: "physics", label: "Physics" },
  { tag: "materials-science", label: "Materials Science" },
  { tag: "economics", label: "Economics" },
  { tag: "machine-learning", label: "Machine Learning" },
  { tag: "bioinformatics", label: "Bioinformatics" },
  { tag: "climate", label: "Climate" },
  { tag: "other", label: "Other" },
];

export interface DataInterestChip {
  /** Stable id used for store persistence and as the `data_interests` tag. */
  id: string;
  /** User-facing label. */
  label: string;
  /**
   * If set, the id also matches a dataset slug in the registry that we can
   * auto-connect as an @dataset:<slug> mention on the first thread.
   */
  datasetSlug?: string;
  /**
   * If set, the id matches a provider slug in the registry that we can
   * auto-connect as an @provider:<slug> mention. Lower-fidelity than a
   * dataset but still gives the agent a catalog to work from.
   */
  providerSlug?: string;
}

/**
 * Per-field data-source chips. Order is intentional: the most
 * widely-recognized connectable source first, then proprietary/manual
 * sources, then "other" as a capture-all.
 */
export const DATA_INTERESTS_BY_FIELD: Record<FieldTag, ReadonlyArray<DataInterestChip>> = {
  oncology: [
    { id: "cbioportal", label: "cBioPortal", providerSlug: "cbioportal" },
    { id: "depmap", label: "DepMap", providerSlug: "depmap" },
    { id: "seer", label: "SEER", providerSlug: "seer" },
    { id: "tcga", label: "TCGA", providerSlug: "tcga" },
    { id: "stjude", label: "St. Jude Cloud", providerSlug: "stjude-cloud" },
    { id: "geo-sra", label: "GEO / SRA", providerSlug: "ncbi-geo" },
    { id: "clinicaltrials", label: "Clinical trials", providerSlug: "clinicaltrials-gov" },
    { id: "own-lab", label: "My own lab data" },
    { id: "other", label: "Other" },
  ],
  genomics: [
    { id: "geo-sra", label: "GEO / SRA", providerSlug: "ncbi-geo" },
    { id: "ensembl", label: "Ensembl", providerSlug: "ensembl" },
    { id: "ucsc", label: "UCSC Genome Browser", providerSlug: "ucsc" },
    { id: "gnomad", label: "gnomAD", providerSlug: "gnomad" },
    { id: "uk-biobank", label: "UK Biobank", providerSlug: "uk-biobank" },
    { id: "1000-genomes", label: "1000 Genomes", providerSlug: "igsr" },
    { id: "encode", label: "ENCODE", providerSlug: "encode" },
    { id: "own-lab", label: "My own lab data" },
    { id: "other", label: "Other" },
  ],
  neuroscience: [
    { id: "openneuro", label: "OpenNeuro", providerSlug: "openneuro" },
    { id: "hcp", label: "HCP", providerSlug: "human-connectome-project" },
    { id: "abcd", label: "ABCD Study", providerSlug: "abcd-study" },
    { id: "adni", label: "ADNI", providerSlug: "adni" },
    { id: "allen-brain", label: "Allen Brain Atlas", providerSlug: "allen-brain" },
    { id: "ukb-imaging", label: "UK Biobank Imaging", providerSlug: "uk-biobank" },
    { id: "own-lab", label: "My own lab data" },
    { id: "other", label: "Other" },
  ],
  immunology: [
    { id: "immport", label: "ImmPort", providerSlug: "immport" },
    { id: "10x-immune", label: "10x Immune atlases", providerSlug: "10x-genomics" },
    { id: "geo-sra", label: "GEO / SRA", providerSlug: "ncbi-geo" },
    { id: "iedb", label: "IEDB", providerSlug: "iedb" },
    { id: "opentargets", label: "Open Targets", providerSlug: "open-targets" },
    { id: "clinicaltrials", label: "Clinical trials", providerSlug: "clinicaltrials-gov" },
    { id: "own-lab", label: "My own lab data" },
    { id: "other", label: "Other" },
  ],
  "drug-discovery": [
    { id: "chembl", label: "ChEMBL", providerSlug: "chembl" },
    { id: "pubchem", label: "PubChem", providerSlug: "pubchem" },
    { id: "drugbank", label: "DrugBank", providerSlug: "drugbank" },
    { id: "opentargets", label: "Open Targets", providerSlug: "open-targets" },
    { id: "pdb", label: "PDB", providerSlug: "rcsb-pdb" },
    { id: "zinc", label: "ZINC", providerSlug: "zinc" },
    { id: "own-lab", label: "My own lab data" },
    { id: "other", label: "Other" },
  ],
  "clinical-epidemiology": [
    { id: "seer", label: "SEER", providerSlug: "seer" },
    { id: "cdc-wonder", label: "CDC WONDER", providerSlug: "cdc-wonder" },
    { id: "nhanes", label: "NHANES", providerSlug: "nhanes" },
    { id: "uk-biobank", label: "UK Biobank", providerSlug: "uk-biobank" },
    { id: "mimic", label: "MIMIC-IV", providerSlug: "mimic" },
    { id: "clinicaltrials", label: "Clinical trials", providerSlug: "clinicaltrials-gov" },
    { id: "who", label: "WHO GHO", providerSlug: "who-gho" },
    { id: "own-lab", label: "My own lab data" },
    { id: "other", label: "Other" },
  ],
  ecology: [
    { id: "gbif", label: "GBIF", providerSlug: "gbif" },
    { id: "ebird", label: "eBird", providerSlug: "ebird" },
    { id: "inaturalist", label: "iNaturalist", providerSlug: "inaturalist" },
    { id: "noaa", label: "NOAA", providerSlug: "noaa" },
    { id: "neon", label: "NEON", providerSlug: "neon" },
    { id: "movebank", label: "Movebank", providerSlug: "movebank" },
    { id: "own-lab", label: "My own field data" },
    { id: "other", label: "Other" },
  ],
  physics: [
    { id: "arxiv", label: "arXiv", providerSlug: "arxiv" },
    { id: "hepdata", label: "HEPData", providerSlug: "hepdata" },
    { id: "inspire", label: "INSPIRE-HEP", providerSlug: "inspire-hep" },
    { id: "cern-opendata", label: "CERN Open Data", providerSlug: "cern-opendata" },
    { id: "mast", label: "MAST (astro)", providerSlug: "mast" },
    { id: "ligo", label: "LIGO Open Science", providerSlug: "ligo" },
    { id: "own-lab", label: "My own experimental data" },
    { id: "other", label: "Other" },
  ],
  "materials-science": [
    { id: "materials-project", label: "Materials Project", providerSlug: "materials-project" },
    { id: "aflow", label: "AFLOW", providerSlug: "aflow" },
    { id: "oqmd", label: "OQMD", providerSlug: "oqmd" },
    { id: "nomad", label: "NOMAD", providerSlug: "nomad" },
    { id: "icsd", label: "ICSD", providerSlug: "icsd" },
    { id: "citrination", label: "Citrination", providerSlug: "citrination" },
    { id: "own-lab", label: "My own lab data" },
    { id: "other", label: "Other" },
  ],
  economics: [
    { id: "fred", label: "FRED", providerSlug: "fred" },
    { id: "world-bank", label: "World Bank", providerSlug: "world-bank" },
    { id: "bls", label: "BLS", providerSlug: "bls" },
    { id: "ipums", label: "IPUMS", providerSlug: "ipums" },
    { id: "oecd", label: "OECD", providerSlug: "oecd" },
    { id: "imf", label: "IMF", providerSlug: "imf" },
    { id: "own-lab", label: "My own microdata" },
    { id: "other", label: "Other" },
  ],
  "machine-learning": [
    { id: "huggingface", label: "Hugging Face", providerSlug: "huggingface" },
    { id: "kaggle", label: "Kaggle", providerSlug: "kaggle" },
    { id: "openml", label: "OpenML", providerSlug: "openml" },
    { id: "papers-with-code", label: "Papers with Code", providerSlug: "paperswithcode" },
    { id: "zenodo", label: "Zenodo", providerSlug: "zenodo" },
    { id: "arxiv", label: "arXiv", providerSlug: "arxiv" },
    { id: "own-lab", label: "My own dataset" },
    { id: "other", label: "Other" },
  ],
  bioinformatics: [
    { id: "geo-sra", label: "GEO / SRA", providerSlug: "ncbi-geo" },
    { id: "ensembl", label: "Ensembl", providerSlug: "ensembl" },
    { id: "ucsc", label: "UCSC Genome Browser", providerSlug: "ucsc" },
    { id: "uniprot", label: "UniProt", providerSlug: "uniprot" },
    { id: "pdb", label: "PDB", providerSlug: "rcsb-pdb" },
    { id: "kegg", label: "KEGG", providerSlug: "kegg" },
    { id: "own-lab", label: "My own lab data" },
    { id: "other", label: "Other" },
  ],
  climate: [
    { id: "noaa", label: "NOAA", providerSlug: "noaa" },
    { id: "era5", label: "ERA5 / Copernicus", providerSlug: "copernicus" },
    { id: "nasa-giss", label: "NASA GISS", providerSlug: "nasa-giss" },
    { id: "cmip6", label: "CMIP6", providerSlug: "cmip6" },
    { id: "berkeley-earth", label: "Berkeley Earth", providerSlug: "berkeley-earth" },
    { id: "ipcc", label: "IPCC data", providerSlug: "ipcc" },
    { id: "own-lab", label: "My own observations" },
    { id: "other", label: "Other" },
  ],
  other: [
    { id: "arxiv", label: "arXiv", providerSlug: "arxiv" },
    { id: "zenodo", label: "Zenodo", providerSlug: "zenodo" },
    { id: "figshare", label: "Figshare", providerSlug: "figshare" },
    { id: "dryad", label: "Dryad", providerSlug: "dryad" },
    { id: "huggingface", label: "Hugging Face", providerSlug: "huggingface" },
    { id: "kaggle", label: "Kaggle", providerSlug: "kaggle" },
    { id: "own-lab", label: "My own data" },
    { id: "other", label: "Other" },
  ],
};

/**
 * Superset shown when no field has been selected yet. Deliberately a
 * generalist's sampler: broad, cross-domain, with a few perennial favorites.
 */
export const GENERIC_DATA_INTERESTS: ReadonlyArray<DataInterestChip> = [
  { id: "arxiv", label: "arXiv", providerSlug: "arxiv" },
  { id: "zenodo", label: "Zenodo", providerSlug: "zenodo" },
  { id: "figshare", label: "Figshare", providerSlug: "figshare" },
  { id: "huggingface", label: "Hugging Face", providerSlug: "huggingface" },
  { id: "kaggle", label: "Kaggle", providerSlug: "kaggle" },
  { id: "geo-sra", label: "GEO / SRA", providerSlug: "ncbi-geo" },
  { id: "world-bank", label: "World Bank", providerSlug: "world-bank" },
  { id: "own-lab", label: "My own data" },
  { id: "other", label: "Other" },
];

export function resolveDataInterestChips(
  fields: ReadonlyArray<FieldTag>,
): ReadonlyArray<DataInterestChip> {
  if (fields.length === 0) {
    return GENERIC_DATA_INTERESTS;
  }
  const seen = new Set<string>();
  const ordered: DataInterestChip[] = [];
  for (const field of fields) {
    for (const chip of DATA_INTERESTS_BY_FIELD[field] ?? []) {
      if (seen.has(chip.id)) continue;
      seen.add(chip.id);
      ordered.push(chip);
    }
  }
  return ordered;
}

export function resolveFieldDefinition(tag: FieldTag): FieldDefinition | null {
  return FIELD_DEFINITIONS.find((entry) => entry.tag === tag) ?? null;
}

export function resolveDataInterestChip(
  fields: ReadonlyArray<FieldTag>,
  id: string,
): DataInterestChip | null {
  const pool = resolveDataInterestChips(fields);
  return pool.find((chip) => chip.id === id) ?? null;
}

export const OPEN_AUTO_CONNECT_DATASET_IDS: ReadonlySet<string> = new Set([
  "seer",
  "cbioportal",
  "depmap",
  "tcga",
  "geo-sra",
  "arxiv",
  "huggingface",
  "kaggle",
  "openml",
  "zenodo",
  "figshare",
  "ensembl",
  "ucsc",
  "gnomad",
  "1000-genomes",
  "encode",
  "openneuro",
  "hcp",
  "abcd",
  "adni",
  "allen-brain",
  "immport",
  "iedb",
  "opentargets",
  "chembl",
  "pubchem",
  "drugbank",
  "pdb",
  "zinc",
  "cdc-wonder",
  "nhanes",
  "mimic",
  "who",
  "clinicaltrials",
  "gbif",
  "ebird",
  "inaturalist",
  "noaa",
  "neon",
  "movebank",
  "hepdata",
  "inspire",
  "cern-opendata",
  "mast",
  "ligo",
  "materials-project",
  "aflow",
  "oqmd",
  "nomad",
  "icsd",
  "citrination",
  "fred",
  "world-bank",
  "bls",
  "ipums",
  "oecd",
  "imf",
  "papers-with-code",
  "uniprot",
  "kegg",
  "era5",
  "nasa-giss",
  "cmip6",
  "berkeley-earth",
  "ipcc",
  "dryad",
]);

/** A dataset interest we can't auto-connect (text-only signal). */
export const MANUAL_ONLY_DATASET_IDS: ReadonlySet<string> = new Set([
  "own-lab",
  "other",
]);
