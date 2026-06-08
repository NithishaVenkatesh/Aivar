export interface SystemNode {
  canonical_name: string
  category: string
  criticality: string
  confidence: number
  auth_method: string | null
  mention_count: number
  source_documents: string[]
  evidence: string[]
  needs_human_review: boolean
  review_note: string | null
}

export interface SystemRelationship {
  source: string
  target: string
  relation: string
  direction: string
  confidence: number
  evidence: string
}

export interface DiscoveryResult {
  systems: SystemNode[]
  relationships: SystemRelationship[]
  graph_stats: { total_nodes: number; total_edges: number }
  total_documents_processed: number
  total_systems_found: number
  systems_flagged_for_review: number
}

export interface Gap {
  source_system: string
  destination_system: string
  entities: string[]
  triggers: string[]
  status: "available" | "missing"
  effort: "S" | "M" | "L" | "XL" | null
  effort_rationale: string | null
  use_cases_blocked: string[]
  priority_score: number
}

export interface DependencyLink {
  integration: string
  required_before: string[]
}

export interface GapReport {
  use_cases_analyzed: number
  total_gaps: number
  missing_integrations: number
  gaps: Gap[]
  dependency_graph: DependencyLink[]
  skipped: {
    unmapped_use_cases: Array<{ text: string; reason: string }>
    rejected_systems: Array<{ use_case: string; system: string; reason: string }>
    missing_capabilities: Array<{ use_case: string; capability_needed: string }>
  }
}

export interface ValidationReport {
  connector_compiles: boolean
  connector_imports: boolean
  agent_def_valid: boolean
  tests_pass: boolean
  failures: string[]
  valid: boolean
}

export interface GeneratedBundle {
  gap_key: string
  source_system: string
  destination_system: string
  connector_code: string
  agent_def_yaml: string
  test_code: string
  readme: string
  requirements: string
  validation: ValidationReport
  artifacts_dir: string | null
  paradigm: string
  manual_setup_required: boolean
  paradigm_notes: string
}

export type ThreadItem =
  | { kind: "welcome"; id: string }
  | { kind: "user"; id: string; text: string; fileNames: string[] }
  | { kind: "thinking"; id: string; stage: "l1" | "l2" | "l3"; label: string; feed: string[] }
  | { kind: "error"; id: string; stage: "l1" | "l2" | "l3"; message: string }
  | { kind: "l1"; id: string; result: DiscoveryResult }
  | { kind: "l2"; id: string; report: GapReport }
  | { kind: "l3"; id: string; bundles: GeneratedBundle[] }
