/**
 * TypeScript types for axon sidecar API responses.
 */

export interface ChangedSymbol {
  file: string;
  name: string;
  type: string;
  lines?: { start: number; end: number };
}

export interface ImpactEntry {
  name: string;
  file: string;
  type?: string;
  confidence?: number;
}

export interface BlastRadius {
  [depth: string]: ImpactEntry[];
}

export interface SymbolContext {
  callers: Array<{ name: string; file?: string }>;
  callees: Array<{ name: string; file?: string }>;
  types: Array<{ name: string; file?: string }>;
  community: { id: number; name: string } | null;
  dead_code_status?: string;
}

export interface DeadSymbol {
  file: string;
  name: string;
  type: string;
}

export interface IndexResult {
  status: "ready" | "failed";
  symbols: number;
  edges: number;
  clusters: number;
  duration_ms: number;
  clone_duration_ms: number;
  analyze_duration_ms: number;
  error?: string | null;
}

export interface RepoStatus {
  indexed: boolean;
  graph_size_bytes: number;
}

export interface DetectChangesResult {
  changed_symbols: ChangedSymbol[];
}

export interface ImpactResult {
  blast_radius: BlastRadius;
}

export interface DeadCodeResult {
  dead_symbols: DeadSymbol[];
}

/**
 * Aggregated structural context for an entire review.
 */
export interface StructuralContext {
  changedSymbols: ChangedSymbol[];
  impactBySymbol: Map<string, BlastRadius>;
  contextBySymbol: Map<string, SymbolContext>;
  deadCode: DeadSymbol[];
  indexStatus: IndexResult;
}
