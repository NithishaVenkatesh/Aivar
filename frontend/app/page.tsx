"use client"

import { useState, useCallback, useEffect } from "react"
import { useDropzone } from "react-dropzone"
import { createZip, downloadZip } from "../lib/zip"

// ---------------------------------------------------------------------------
// Level 1 types
// ---------------------------------------------------------------------------

interface SystemNode {
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

interface SystemRelationship {
  source: string
  target: string
  relation: string
  direction: string
  confidence: number
  evidence: string
}

interface DiscoveryResult {
  systems: SystemNode[]
  relationships: SystemRelationship[]
  graph_stats: { total_nodes: number; total_edges: number }
  total_documents_processed: number
  total_systems_found: number
  systems_flagged_for_review: number
}

// ---------------------------------------------------------------------------
// Level 2 types
// ---------------------------------------------------------------------------

interface Gap {
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

interface DependencyLink {
  integration: string
  required_before: string[]
}

interface GapReport {
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

// ---------------------------------------------------------------------------
// State machines (no log arrays — logs go to terminal via console.error)
// ---------------------------------------------------------------------------

type L1State =
  | { phase: "idle" }
  | { phase: "processing" }
  | { phase: "done"; result: DiscoveryResult }
  | { phase: "error"; message: string }

type L2State =
  | { phase: "idle" }
  | { phase: "processing" }
  | { phase: "done"; report: GapReport }
  | { phase: "error"; message: string }

// ---------------------------------------------------------------------------
// Level 3 types
// ---------------------------------------------------------------------------

interface ValidationReport {
  connector_compiles: boolean
  connector_imports: boolean
  agent_def_valid: boolean
  tests_pass: boolean
  failures: string[]
  valid: boolean
}

interface GeneratedBundle {
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

type L3State =
  | { phase: "idle" }
  | { phase: "processing" }
  | { phase: "done"; bundles: GeneratedBundle[] }
  | { phase: "error"; message: string }

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const CRITICALITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-300 border border-red-200/50 dark:border-red-800/40",
  high: "bg-orange-100 dark:bg-orange-950/40 text-orange-800 dark:text-orange-300 border border-orange-200/50 dark:border-orange-800/40",
  medium: "bg-yellow-100 dark:bg-yellow-950/40 text-yellow-800 dark:text-yellow-300 border border-yellow-200/50 dark:border-yellow-800/40",
  low: "bg-green-100 dark:bg-green-950/40 text-green-800 dark:text-green-300 border border-green-200/50 dark:border-green-800/40",
  unknown: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200/50 dark:border-slate-700/50",
}

const EFFORT_COLORS: Record<string, string> = {
  S: "bg-green-100 dark:bg-green-950/40 text-green-800 dark:text-green-300 border border-green-200/50 dark:border-green-800/40",
  M: "bg-yellow-100 dark:bg-yellow-950/40 text-yellow-800 dark:text-yellow-300 border border-yellow-200/50 dark:border-yellow-800/40",
  L: "bg-orange-100 dark:bg-orange-950/40 text-orange-800 dark:text-orange-300 border border-orange-200/50 dark:border-orange-800/40",
  XL: "bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-300 border border-red-200/50 dark:border-red-800/40",
}

const EFFORT_LABELS: Record<string, string> = {
  S: "1-3 days",
  M: "1-2 weeks",
  L: "3-6 weeks",
  XL: "2+ months",
}

const STATUS_COLORS: Record<string, string> = {
  available: "bg-green-100 dark:bg-green-950/40 text-green-800 dark:text-green-300 border border-green-200/50 dark:border-green-800/40",
  missing: "bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-300 border border-red-200/50 dark:border-red-800/40",
}

// ---------------------------------------------------------------------------
// Cycling status messages shown during processing
// ---------------------------------------------------------------------------

const L1_MESSAGES = [
  "Parsing your documents...",
  "Identifying system names and APIs...",
  "Building your system inventory...",
  "Cross-referencing mentions across files...",
  "Analysing system relationships...",
  "Calculating confidence scores...",
]

const L2_MESSAGES = [
  "Matching goals to discovered systems...",
  "Identifying missing integrations...",
  "Scoring integration gaps by priority...",
  "Mapping dependency order...",
  "Reviewing unmapped use cases...",
]

const L3_MESSAGES = [
  "Generating connector code...",
  "Writing agent definition YAML...",
  "Creating test scaffolding...",
  "Validating generated connectors...",
  "Packaging connector bundles...",
]

function useStatusMessage(messages: string[], active: boolean): string {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (!active) { setIndex(0); return }
    const id = setInterval(() => setIndex((i) => (i + 1) % messages.length), 2800)
    return () => clearInterval(id)
  }, [active, messages.length])

  return messages[index]
}

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider ${color}`}>
      {text}
    </span>
  )
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value)
  const color = pct >= 80 ? "bg-green-500" : pct >= 60 ? "bg-yellow-500" : "bg-red-500"
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-500 dark:text-slate-400 w-8 text-right font-mono">{pct}%</span>
    </div>
  )
}

function ProcessingCard({ message }: { message: string }) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 px-5 py-6 shadow-sm flex items-center gap-4">
      <div className="relative flex items-center justify-center shrink-0">
        <span className="absolute inline-flex h-10 w-10 rounded-full bg-brand-500/20 dark:bg-brand-400/15 agentic-pulse" />
        <div className="relative w-10 h-10 rounded-full bg-gradient-to-tr from-brand-600 to-indigo-600 dark:from-brand-500 dark:to-indigo-500 flex items-center justify-center shadow-sm">
          <svg className="w-5 h-5 text-white animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 transition-all duration-500">{message}</p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">This may take a moment — logs are in the terminal</p>
      </div>
    </div>
  )
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 rounded-xl p-4 flex items-start gap-3">
      <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <div>
        <p className="text-sm font-semibold text-red-700 dark:text-red-300">Something went wrong</p>
        <p className="text-sm text-red-600 dark:text-red-400 mt-0.5">{message}</p>
        <p className="text-xs text-red-400 dark:text-red-500 mt-1">Check the terminal for detailed logs</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pipeline progress indicator
// ---------------------------------------------------------------------------

type StageStatus = "idle" | "processing" | "done" | "error" | "skipped"

function PipelineProgress({
  stages,
}: {
  stages: Array<{ label: string; status: StageStatus; detail?: string }>
}) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800/80 px-5 py-4 shadow-sm">
      <div className="flex items-start gap-0">
        {stages.map((stage, i) => {
          const { status } = stage
          const isDone = status === "done"
          const isActive = status === "processing"
          const isError = status === "error"
          const isSkipped = status === "skipped"

          return (
            <div key={i} className="flex items-start flex-1 min-w-0">
              <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all
                  ${isDone   ? "bg-green-500 text-white"
                  : isActive ? "bg-brand-600 text-white ring-4 ring-brand-100 dark:ring-brand-950"
                  : isError  ? "bg-red-500 text-white"
                  : isSkipped? "bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500"
                  :            "bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500"}`}
                >
                  {isDone    ? "✓"
                  : isError  ? "✗"
                  : isActive ? <span className="animate-pulse">{i + 1}</span>
                  :            i + 1}
                </div>
                <div className="text-center px-1 min-w-0">
                  <p className={`text-xs font-semibold leading-tight
                    ${isDone    ? "text-slate-700 dark:text-slate-300"
                    : isActive  ? "text-brand-700 dark:text-brand-400"
                    : isError   ? "text-red-600 dark:text-red-400"
                    :             "text-slate-400 dark:text-slate-500"}`}
                  >
                    {stage.label}
                  </p>
                  {stage.detail && (
                    <p className={`text-[10px] mt-0.5 leading-tight font-medium
                      ${isDone    ? "text-green-600 dark:text-green-400"
                      : isActive  ? "text-slate-500 dark:text-slate-400"
                      : isError   ? "text-red-400 dark:text-red-500"
                      : isSkipped ? "text-slate-450 dark:text-slate-500"
                      :             "text-slate-400 dark:text-slate-500"}`}
                    >
                      {stage.detail}
                    </p>
                  )}
                </div>
              </div>
              {i < stages.length - 1 && (
                <div className={`h-px w-full mt-4 mx-1 shrink-0 transition-colors
                  ${isDone ? "bg-green-300 dark:bg-green-900" : "bg-slate-200 dark:bg-slate-800"}`}
                  style={{ minWidth: "1rem" }}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bundle download helpers
// ---------------------------------------------------------------------------

function bundleSlug(b: GeneratedBundle): string {
  return `${b.source_system}_to_${b.destination_system}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function bundleFiles(b: GeneratedBundle): { name: string; content: string }[] {
  const slug = bundleSlug(b)
  return [
    { name: `${slug}/connector.py`,      content: b.connector_code },
    { name: `${slug}/agent_def.yaml`,    content: b.agent_def_yaml },
    { name: `${slug}/test_connector.py`, content: b.test_code },
    { name: `${slug}/requirements.txt`,  content: b.requirements },
    { name: `${slug}/README.md`,         content: b.readme },
  ]
}

function downloadBundle(b: GeneratedBundle): void {
  downloadZip(createZip(bundleFiles(b)), `${bundleSlug(b)}.zip`)
}

function downloadAllBundles(bundles: GeneratedBundle[]): void {
  const files = bundles.flatMap(bundleFiles)
  downloadZip(createZip(files), "connectors.zip")
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function HomePage() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null)

  const [files, setFiles] = useState<File[]>([])
  const [useCaseText, setUseCaseText] = useState("")

  const [l1State, setL1State] = useState<L1State>({ phase: "idle" })
  const [l2State, setL2State] = useState<L2State>({ phase: "idle" })
  const [l3State, setL3State] = useState<L3State>({ phase: "idle" })

  const [activeTab, setActiveTab] = useState<"systems" | "relationships">("systems")
  const [l2Tab, setL2Tab] = useState<"gaps" | "dependencies" | "skipped">("gaps")
  const [expandedBundle, setExpandedBundle] = useState<number | null>(null)
  const [bundleFileTab, setBundleFileTab] = useState<"connector" | "agent_def" | "tests" | "requirements" | "readme">("connector")

  const l1Msg = useStatusMessage(L1_MESSAGES, l1State.phase === "processing")
  const l2Msg = useStatusMessage(L2_MESSAGES, l2State.phase === "processing")
  const l3Msg = useStatusMessage(L3_MESSAGES, l3State.phase === "processing")

  useEffect(() => {
    const saved = localStorage.getItem("aivar-theme") as "light" | "dark" | null
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
    setTheme(saved || (prefersDark ? "dark" : "light"))
  }, [])

  const toggleTheme = () => {
    if (!theme) return
    const next = theme === "light" ? "dark" : "light"
    setTheme(next)
    localStorage.setItem("aivar-theme", next)
    document.documentElement.classList.add("transitioning")
    if (next === "dark") {
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
    }
    setTimeout(() => document.documentElement.classList.remove("transitioning"), 200)
  }

  const onDrop = useCallback((accepted: File[]) => {
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name))
      return [...prev, ...accepted.filter((f) => !names.has(f.name))]
    })
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
      "text/markdown": [".md"],
      "text/plain": [".txt"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "text/csv": [".csv"],
      "image/*": [".png", ".jpg", ".jpeg", ".webp"],
    },
  })

  const removeFile = (name: string) =>
    setFiles((prev) => prev.filter((f) => f.name !== name))

  // -------------------------------------------------------------------------
  // Level 1
  // -------------------------------------------------------------------------
  const runDiscovery = async (): Promise<DiscoveryResult | null> => {
    setL1State({ phase: "processing" })
    setL2State({ phase: "idle" })
    setL3State({ phase: "idle" })
    setExpandedBundle(null)

    const form = new FormData()
    files.forEach((f) => form.append("files", f))

    try {
      const res = await fetch("/api/discover", { method: "POST", body: form })
      if (!res.ok || !res.body) {
        const data = await res.json()
        setL1State({ phase: "error", message: data.error ?? "Request failed" })
        return null
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let result: DiscoveryResult | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          let event: { type: string; message?: string; data?: DiscoveryResult }
          try { event = JSON.parse(line.slice(6)) } catch { continue }

          if (event.type === "log") {
            continue // logs go to terminal via console.error in API route
          } else if (event.type === "result" && event.data) {
            result = event.data
            setL1State({ phase: "done", result: event.data })
          } else if (event.type === "error" && event.message) {
            setL1State({ phase: "error", message: event.message })
            return null
          }
        }
      }
      return result
    } catch (err: unknown) {
      setL1State({ phase: "error", message: err instanceof Error ? err.message : "Unknown error" })
      return null
    }
  }

  // -------------------------------------------------------------------------
  // Level 2
  // -------------------------------------------------------------------------
  const runGapAnalysis = async (
    inventory: DiscoveryResult,
    useCases: string,
  ): Promise<GapReport | null> => {
    setL2State({ phase: "processing" })

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inventory, use_cases: useCases }),
      })

      if (!res.ok || !res.body) {
        const data = await res.json()
        setL2State({ phase: "error", message: data.error ?? "Request failed" })
        return null
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let report: GapReport | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          let event: { type: string; message?: string; data?: GapReport }
          try { event = JSON.parse(line.slice(6)) } catch { continue }

          if (event.type === "log") {
            continue
          } else if (event.type === "result" && event.data) {
            report = event.data
            setL2State({ phase: "done", report: event.data })
          } else if (event.type === "error" && event.message) {
            setL2State({ phase: "error", message: event.message })
            return null
          }
        }
      }
      return report
    } catch (err: unknown) {
      setL2State({ phase: "error", message: err instanceof Error ? err.message : "Unknown error" })
      return null
    }
  }

  // -------------------------------------------------------------------------
  // Level 3
  // -------------------------------------------------------------------------
  const runGenerate = async (
    inventory: DiscoveryResult,
    gapReport: GapReport,
  ): Promise<void> => {
    setL3State({ phase: "processing" })
    setExpandedBundle(null)

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inventory, gap_report: gapReport }),
      })

      if (!res.ok || !res.body) {
        const data = await res.json()
        setL3State({ phase: "error", message: data.error ?? "Request failed" })
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          let event: { type: string; message?: string; data?: { bundles: GeneratedBundle[] } }
          try { event = JSON.parse(line.slice(6)) } catch { continue }

          if (event.type === "log") {
            continue
          } else if (event.type === "result" && event.data) {
            setL3State({ phase: "done", bundles: event.data.bundles })
          } else if (event.type === "error" && event.message) {
            setL3State({ phase: "error", message: event.message })
            return
          }
        }
      }
    } catch (err: unknown) {
      setL3State({ phase: "error", message: err instanceof Error ? err.message : "Unknown error" })
    }
  }

  // -------------------------------------------------------------------------
  // Autonomous pipeline
  // -------------------------------------------------------------------------
  const runAll = async () => {
    if (!files.length || !useCaseText.trim()) return

    const inventory = await runDiscovery()
    if (!inventory) return

    const report = await runGapAnalysis(inventory, useCaseText)
    if (!report) return

    if (report.missing_integrations > 0) {
      await runGenerate(inventory, report)
    }
  }

  const reset = () => {
    setL1State({ phase: "idle" })
    setL2State({ phase: "idle" })
    setL3State({ phase: "idle" })
    setExpandedBundle(null)
    setFiles([])
    setUseCaseText("")
  }

  const isRunning =
    l1State.phase === "processing" ||
    l2State.phase === "processing" ||
    l3State.phase === "processing"

  const hasStarted = l1State.phase !== "idle"

  const l1Result = l1State.phase === "done" ? l1State.result : null
  const l2Report = l2State.phase === "done" ? l2State.report : null
  const l3Bundles = l3State.phase === "done" ? l3State.bundles : null

  const l3StageStatus = (): StageStatus => {
    if (l3State.phase !== "idle") return l3State.phase as StageStatus
    if (l2State.phase === "done" && l2Report && l2Report.missing_integrations === 0) return "skipped"
    return "idle"
  }

  const pipelineStages = [
    {
      label: "Discover Systems",
      status: l1State.phase as StageStatus,
      detail: l1State.phase === "done"
        ? `${l1Result?.total_systems_found ?? 0} systems found`
        : l1State.phase === "processing" ? "Analysing documents..."
        : l1State.phase === "error" ? "Failed"
        : undefined,
    },
    {
      label: "Analyse Gaps",
      status: l2State.phase as StageStatus,
      detail: l2State.phase === "done"
        ? `${l2Report?.missing_integrations ?? 0} missing integrations`
        : l2State.phase === "processing" ? "Mapping use cases..."
        : l2State.phase === "error" ? "Failed"
        : undefined,
    },
    {
      label: "Generate Connectors",
      status: l3StageStatus(),
      detail: l3State.phase === "done"
        ? `${l3Bundles?.length ?? 0} bundle(s) generated`
        : l3State.phase === "processing" ? "Building connectors..."
        : l3State.phase === "error" ? "Failed"
        : l3StageStatus() === "skipped" ? "No missing integrations"
        : undefined,
    },
  ]

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Header */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center shadow-md">
            <span className="text-white text-sm font-bold">A</span>
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight">Aivar Discovery Agent</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Enterprise system discovery &amp; integration gap analysis</p>
          </div>
        </div>

        {theme && (
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-850 transition-colors shadow-sm bg-white dark:bg-slate-900"
            aria-label="Toggle theme"
          >
            {theme === "light" ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
              </svg>
            )}
          </button>
        )}
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* Input panel */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800/80 overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-850 bg-slate-50/50 dark:bg-slate-900/30">
            <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300">Configure Analysis</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Upload your architecture documents and describe your automation goals — the agent will discover systems, analyse gaps, and generate connectors automatically.
            </p>
          </div>

          <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Left — file upload */}
            <div className="space-y-3">
              <p className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                Architecture Documents
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                Runbooks, system inventories, architecture diagrams, contracts — anything describing your tech stack.
              </p>

              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all duration-300
                  ${isDragActive
                    ? "border-brand-500 bg-brand-50/50 dark:bg-brand-950/20"
                    : "border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/20 hover:border-brand-400 dark:hover:border-brand-500 hover:bg-white dark:hover:bg-slate-900"
                  }
                  ${isRunning ? "pointer-events-none opacity-60" : ""}`}
              >
                <input {...getInputProps()} />
                <div className="flex flex-col items-center gap-2 text-slate-500">
                  <svg className="w-8 h-8 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    {isDragActive ? "Drop files here" : "Drop files or click to browse"}
                  </p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">PDF, DOCX, PPTX, XLSX, CSV, MD, TXT, PNG, JPG</p>
                </div>
              </div>

              {files.length > 0 && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800/80 max-h-48 overflow-y-auto">
                  {files.map((f) => (
                    <div key={f.name} className="flex items-center px-3 py-2 gap-2 hover:bg-slate-50 dark:hover:bg-slate-950/50">
                      <span className="text-[10px] font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-455 uppercase shrink-0">
                        {f.name.split(".").pop()}
                      </span>
                      <span className="flex-1 text-xs text-slate-700 dark:text-slate-300 truncate font-medium">{f.name}</span>
                      <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">{(f.size / 1024).toFixed(1)} KB</span>
                      <button
                        onClick={() => removeFile(f.name)}
                        disabled={isRunning}
                        className="text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors disabled:opacity-40"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right — use cases */}
            <div className="space-y-3">
              <p className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                Automation Goals
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                One goal per line — describe what business outcomes you want to automate across your systems.
              </p>
              <textarea
                value={useCaseText}
                onChange={(e) => setUseCaseText(e.target.value)}
                disabled={isRunning}
                placeholder={
                  "Sync new leads from the website to the CRM automatically\n" +
                  "Auto-generate invoices when a deal is marked closed-won\n" +
                  "Send order confirmation emails via the communication platform\n" +
                  "Notify the team when a high-priority ticket is created"
                }
                rows={9}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2.5 text-sm text-slate-800 dark:text-slate-200
                  placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500
                  disabled:bg-slate-50 dark:disabled:bg-slate-950 disabled:text-slate-400 dark:disabled:text-slate-600 resize-none font-mono bg-white dark:bg-slate-950"
              />
            </div>
          </div>

          {/* Actions footer */}
          <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-850 flex items-center gap-3 bg-slate-50/50 dark:bg-slate-900/10">
            <button
              onClick={runAll}
              disabled={!files.length || !useCaseText.trim() || isRunning}
              className="px-5 py-2.5 bg-brand-600 text-white rounded-lg font-semibold hover:bg-brand-700
                disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md shadow-brand-500/10 hover:shadow-lg hover:shadow-brand-500/20 flex items-center gap-2 text-sm"
            >
              {isRunning ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Running Pipeline...
                </>
              ) : (
                "Run Full Analysis"
              )}
            </button>

            {hasStarted && !isRunning && (
              <button
                onClick={reset}
                className="px-4 py-2.5 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors bg-white dark:bg-slate-900"
              >
                Reset
              </button>
            )}

            {!files.length && (
              <p className="text-xs text-slate-400 dark:text-slate-550">Upload at least one document to begin</p>
            )}
            {files.length > 0 && !useCaseText.trim() && (
              <p className="text-xs text-slate-400 dark:text-slate-550">Add at least one automation goal to begin</p>
            )}
          </div>
        </div>

        {/* Pipeline progress */}
        {hasStarted && <PipelineProgress stages={pipelineStages} />}

        {/* Level 1 */}
        {hasStarted && (
          <div className="space-y-4">
            {l1State.phase === "processing" && <ProcessingCard message={l1Msg} />}
            {l1State.phase === "error" && <ErrorCard message={l1State.message} />}

            {l1Result && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { label: "Documents", value: l1Result.total_documents_processed },
                    { label: "Systems Found", value: l1Result.total_systems_found },
                    { label: "Relationships", value: l1Result.graph_stats.total_edges },
                    { label: "Flagged for Review", value: l1Result.systems_flagged_for_review },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
                      <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{value}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      const blob = new Blob([JSON.stringify(l1Result, null, 2)], { type: "application/json" })
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement("a")
                      a.href = url
                      a.download = "discovery_inventory.json"
                      a.click()
                      URL.revokeObjectURL(url)
                    }}
                    className="flex items-center gap-2 px-4 py-2 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-semibold text-slate-600 dark:text-slate-350 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors bg-white dark:bg-slate-900"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download Inventory JSON
                  </button>
                </div>

                <div className="flex gap-1 bg-slate-100 dark:bg-slate-850 rounded-lg p-1 w-fit border border-slate-200/50 dark:border-slate-800">
                  {(["systems", "relationships"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-all capitalize
                        ${activeTab === tab
                          ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm"
                          : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"}`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                {activeTab === "systems" && (
                  <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 text-left">
                            <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">System</th>
                            <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">Category</th>
                            <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">Criticality</th>
                            <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400 w-40">Confidence</th>
                            <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400 text-center">Mentions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                          {l1Result.systems.map((sys, i) => (
                            <tr key={`${sys.canonical_name}-${i}`} className={sys.needs_human_review ? "bg-amber-50/40 dark:bg-amber-950/10" : "hover:bg-slate-50/30 dark:hover:bg-slate-900/20"}>
                              <td className="px-4 py-3">
                                <div className="font-semibold text-slate-900 dark:text-slate-100">{sys.canonical_name}</div>
                                {sys.needs_human_review && sys.review_note && (
                                  <div className="text-xs text-amber-700 dark:text-amber-400 mt-0.5 font-medium flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                                    {sys.review_note}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3 text-slate-600 dark:text-slate-350">{sys.category}</td>
                              <td className="px-4 py-3">
                                <Badge text={sys.criticality} color={CRITICALITY_COLORS[sys.criticality] ?? CRITICALITY_COLORS.unknown} />
                              </td>
                              <td className="px-4 py-3"><ConfidenceBar value={sys.confidence} /></td>
                              <td className="px-4 py-3 text-slate-650 dark:text-slate-400 text-center font-mono">{sys.mention_count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {l1Result.systems.length === 0 && (
                      <div className="px-4 py-8 text-center text-sm text-slate-400">No systems found</div>
                    )}
                  </div>
                )}

                {activeTab === "relationships" && (
                  <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 text-left">
                            <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">Source</th>
                            <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">Relation</th>
                            <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">Target</th>
                            <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400 w-32">Confidence</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                          {l1Result.relationships.map((rel, i) => (
                            <tr key={i} className="hover:bg-slate-50/30 dark:hover:bg-slate-900/20">
                              <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-200">{rel.source}</td>
                              <td className="px-4 py-3">
                                <span className="text-[10px] bg-brand-100 dark:bg-brand-950/60 text-brand-700 dark:text-brand-400 px-2 py-0.5 rounded-full font-bold font-mono border border-brand-200/30">
                                  {rel.relation}
                                </span>
                                <span className="ml-2 text-xs text-slate-400 dark:text-slate-500 font-medium">{rel.direction}</span>
                              </td>
                              <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-200">{rel.target}</td>
                              <td className="px-4 py-3"><ConfidenceBar value={rel.confidence} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {l1Result.relationships.length === 0 && (
                      <div className="px-4 py-8 text-center text-sm text-slate-400">No relationships found</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Level 2 */}
        {l2State.phase !== "idle" && (
          <div className="space-y-4">
            {l2State.phase === "processing" && <ProcessingCard message={l2Msg} />}
            {l2State.phase === "error" && <ErrorCard message={l2State.message} />}

            {l2Report && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { label: "Use Cases Mapped", value: l2Report.use_cases_analyzed },
                    { label: "Total Integration Checks", value: l2Report.total_gaps },
                    { label: "Missing / Partial", value: l2Report.missing_integrations },
                    { label: "Unmapped Use Cases", value: l2Report.skipped.unmapped_use_cases.length },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
                      <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{value}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      const blob = new Blob([JSON.stringify(l2Report, null, 2)], { type: "application/json" })
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement("a")
                      a.href = url
                      a.download = "gap_analysis.json"
                      a.click()
                      URL.revokeObjectURL(url)
                    }}
                    className="flex items-center gap-2 px-4 py-2 border border-slate-300 dark:border-slate-700 rounded-lg text-sm font-semibold text-slate-600 dark:text-slate-350 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors bg-white dark:bg-slate-900"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download Gap Report JSON
                  </button>
                </div>

                <div className="flex gap-1 bg-slate-100 dark:bg-slate-850 rounded-lg p-1 w-fit border border-slate-200/50 dark:border-slate-800">
                  {([
                    { key: "gaps", label: `Gaps (${l2Report.gaps.length})` },
                    { key: "dependencies", label: `Dependencies (${l2Report.dependency_graph.length})` },
                    { key: "skipped", label: `Skipped (${l2Report.skipped.unmapped_use_cases.length + l2Report.skipped.rejected_systems.length})` },
                  ] as const).map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setL2Tab(key)}
                      className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-all
                        ${l2Tab === key
                          ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm"
                          : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {l2Tab === "gaps" && (
                  <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 text-left">
                            <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">Integration</th>
                            <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">Status</th>
                            <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">Effort</th>
                            <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400 text-center">Blocked</th>
                            <th className="px-4 py-3 font-semibold text-slate-600 dark:text-slate-400 text-right">Priority</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                          {l2Report.gaps.map((gap, i) => (
                            <tr key={i} className={gap.status === "missing" ? "bg-red-50/20 dark:bg-red-950/10 hover:bg-red-50/30 dark:hover:bg-red-950/15" : "hover:bg-slate-50/30 dark:hover:bg-slate-900/20"}>
                              <td className="px-4 py-3">
                                <div className="font-semibold text-slate-900 dark:text-slate-150">
                                  {gap.source_system} to {gap.destination_system}
                                </div>
                                {gap.entities.length > 0 && (
                                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-medium">
                                    {gap.entities.join(", ")}
                                  </div>
                                )}
                                {gap.effort_rationale && (
                                  <div className="text-xs text-slate-400 dark:text-slate-500 mt-1 italic font-medium">{gap.effort_rationale}</div>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <Badge text={gap.status} color={STATUS_COLORS[gap.status] ?? "bg-slate-100 text-slate-600"} />
                              </td>
                              <td className="px-4 py-3">
                                {gap.effort ? (
                                  <div className="flex flex-col gap-0.5">
                                    <Badge text={gap.effort} color={EFFORT_COLORS[gap.effort] ?? "bg-slate-100 text-slate-600"} />
                                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold">{EFFORT_LABELS[gap.effort]}</span>
                                  </div>
                                ) : (
                                  <span className="text-xs text-slate-400 dark:text-slate-550 font-mono">-</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-center text-slate-600 dark:text-slate-450 font-mono font-semibold">
                                {gap.use_cases_blocked.length}
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-sm text-slate-700 dark:text-slate-300 font-bold">
                                {gap.priority_score.toFixed(0)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {l2Report.gaps.length === 0 && (
                      <div className="px-4 py-8 text-center text-sm text-slate-400">No integration gaps detected</div>
                    )}
                  </div>
                )}

                {l2Tab === "dependencies" && (
                  <div className="space-y-3">
                    {l2Report.dependency_graph.length === 0 ? (
                      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-8 text-center text-sm text-slate-400">
                        No blocking dependencies
                      </div>
                    ) : (
                      l2Report.dependency_graph.map((dep, i) => (
                        <div key={i} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
                          <div className="flex items-start gap-3">
                            <span className="mt-0.5 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold font-mono whitespace-nowrap border border-slate-200/50 dark:border-slate-700">
                              {dep.integration}
                            </span>
                            <div className="flex-1">
                              <p className="text-xs text-slate-500 dark:text-slate-450 mb-1 font-semibold">must exist before:</p>
                              <ul className="space-y-1">
                                {dep.required_before.map((uc, j) => (
                                  <li key={j} className="text-sm text-slate-750 dark:text-slate-350 flex items-start gap-1.5">
                                    <span className="text-slate-400 dark:text-slate-600 mt-0.5">-</span>
                                    {uc}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {l2Tab === "skipped" && (
                  <div className="space-y-4">
                    {l2Report.skipped.unmapped_use_cases.length > 0 && (
                      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                        <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800">
                          <p className="text-sm font-bold text-slate-700 dark:text-slate-300">Unmapped use cases</p>
                        </div>
                        <div className="divide-y divide-slate-100 dark:divide-slate-800">
                          {l2Report.skipped.unmapped_use_cases.map((item, i) => (
                            <div key={i} className="px-4 py-3">
                              <p className="text-sm text-slate-800 dark:text-slate-200 font-medium">{item.text}</p>
                              <p className="text-xs text-slate-550 dark:text-slate-450 mt-0.5">{item.reason}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {l2Report.skipped.rejected_systems.length > 0 && (
                      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                        <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800">
                          <p className="text-sm font-bold text-slate-700 dark:text-slate-300">Rejected systems (not in inventory)</p>
                        </div>
                        <div className="divide-y divide-slate-100 dark:divide-slate-800">
                          {l2Report.skipped.rejected_systems.map((item, i) => (
                            <div key={i} className="px-4 py-3">
                              <p className="text-sm text-slate-800 dark:text-slate-200 font-bold">{item.system}</p>
                              <p className="text-xs text-slate-550 dark:text-slate-450">{item.use_case}</p>
                              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 italic">{item.reason}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {l2Report.skipped.missing_capabilities.length > 0 && (
                      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                        <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800">
                          <p className="text-sm font-bold text-slate-700 dark:text-slate-300">Missing capabilities</p>
                        </div>
                        <div className="divide-y divide-slate-100 dark:divide-slate-800">
                          {l2Report.skipped.missing_capabilities.map((item, i) => (
                            <div key={i} className="px-4 py-3">
                              <p className="text-sm text-slate-800 dark:text-slate-200 font-medium">{item.capability_needed}</p>
                              <p className="text-xs text-slate-550 dark:text-slate-450">{item.use_case}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {l2Report.skipped.unmapped_use_cases.length === 0 &&
                      l2Report.skipped.rejected_systems.length === 0 &&
                      l2Report.skipped.missing_capabilities.length === 0 && (
                      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-8 text-center text-sm text-slate-400">
                        Nothing was skipped — all use cases were mapped successfully
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Level 3 */}
        {l3State.phase !== "idle" && (
          <div className="space-y-4">
            {l3State.phase === "processing" && <ProcessingCard message={l3Msg} />}
            {l3State.phase === "error" && <ErrorCard message={l3State.message} />}

            {l3Bundles && l3Bundles.length > 0 && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start gap-4">
                  <div className="grid grid-cols-4 gap-4 flex-1">
                    {[
                      { label: "Bundles", value: l3Bundles.length, color: "text-slate-900 dark:text-slate-100" },
                      { label: "Passed", value: l3Bundles.filter(b => !b.manual_setup_required && b.validation.valid).length, color: "text-green-700 dark:text-green-400" },
                      { label: "Failed", value: l3Bundles.filter(b => !b.manual_setup_required && !b.validation.valid).length, color: "text-red-700 dark:text-red-400" },
                      { label: "Manual Setup", value: l3Bundles.filter(b => b.manual_setup_required).length, color: "text-amber-700 dark:text-amber-400" },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
                        <p className={`text-2xl font-bold ${color}`}>{value}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-450 mt-0.5 font-medium">{label}</p>
                      </div>
                    ))}
                  </div>
                  {l3Bundles.some(b => !b.manual_setup_required) && (
                    <button
                      onClick={() => downloadAllBundles(l3Bundles.filter(b => !b.manual_setup_required))}
                      className="flex items-center gap-2 px-4 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-semibold hover:bg-brand-700 transition-all shadow-md shadow-brand-500/10 hover:shadow-lg whitespace-nowrap"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Download All (.zip)
                    </button>
                  )}
                </div>

                {l3Bundles.map((bundle, i) => (
                  <div key={i} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/10">
                      <div className="font-bold text-slate-900 dark:text-slate-200">{bundle.gap_key}</div>
                      <div className="flex items-center gap-2">
                        {bundle.manual_setup_required
                          ? <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/40">MANUAL SETUP</span>
                          : bundle.validation.valid
                            ? <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 dark:bg-green-950/40 text-green-800 dark:text-green-300 border border-green-200/50 dark:border-green-800/40">VALID</span>
                            : <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-300 border border-red-200/50 dark:border-red-800/40">INVALID</span>
                        }
                        {!bundle.manual_setup_required && (
                          <button
                            onClick={() => downloadBundle(bundle)}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-350 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors bg-white dark:bg-slate-900"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            .zip
                          </button>
                        )}
                      </div>
                    </div>

                    {bundle.manual_setup_required && bundle.paradigm_notes && (
                      <div className="px-4 py-3 bg-amber-50/50 dark:bg-amber-950/10 border-b border-slate-100 dark:border-slate-800">
                        <p className="text-xs font-bold text-amber-800 dark:text-amber-400 mb-1">
                          Why auto-generation was skipped ({bundle.paradigm.replace("_", " ")}):
                        </p>
                        <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed whitespace-pre-wrap font-medium">
                          {bundle.paradigm_notes}
                        </p>
                      </div>
                    )}

                    {!bundle.manual_setup_required && (
                      <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/20 dark:bg-slate-900/5">
                        {[
                          { label: "Compiles", ok: bundle.validation.connector_compiles },
                          { label: "Imports", ok: bundle.validation.connector_imports },
                          { label: "YAML valid", ok: bundle.validation.agent_def_valid },
                          { label: "Tests pass", ok: bundle.validation.tests_pass },
                        ].map(({ label, ok }) => (
                          <div key={label} className="flex items-center gap-1.5 text-xs font-medium">
                            <span className={ok ? "text-green-600 dark:text-green-400 font-bold" : "text-red-500 dark:text-red-400 font-bold"}>
                              {ok ? "✓" : "✗"}
                            </span>
                            <span className={ok ? "text-slate-700 dark:text-slate-350" : "text-slate-400 dark:text-slate-500"}>{label}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {!bundle.manual_setup_required && bundle.validation.failures.length > 0 && (
                      <div className="px-4 py-3 bg-red-50/50 dark:bg-red-950/10 border-b border-slate-100 dark:border-slate-800">
                        <p className="text-xs font-bold text-red-700 dark:text-red-400 mb-1.5">Failure details:</p>
                        <ul className="space-y-1">
                          {bundle.validation.failures.map((f, j) => (
                            <li key={j} className="text-xs text-red-600 dark:text-red-400 font-mono whitespace-pre-wrap break-all">{f}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* File viewer — always available for generated bundles */}
                    {!bundle.manual_setup_required && (
                      <>
                        <button
                          onClick={() => {
                            setExpandedBundle(expandedBundle === i ? null : i)
                            setBundleFileTab("connector")
                          }}
                          className="w-full px-4 py-2.5 text-left flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-850 transition-colors border-t border-slate-100 dark:border-slate-800"
                        >
                          <span>View generated source code</span>
                          <svg
                            className={`w-4 h-4 transition-transform duration-200 ${expandedBundle === i ? "rotate-180" : ""}`}
                            fill="none" stroke="currentColor" viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>

                        {expandedBundle === i && (
                          <div className="border-t border-slate-150 dark:border-slate-800">
                            <div className="flex flex-wrap gap-0.5 bg-slate-100 dark:bg-slate-850 p-1 border-b border-slate-200 dark:border-slate-800">
                              {([
                                { key: "connector",    label: "connector.py" },
                                { key: "agent_def",    label: "agent_def.yaml" },
                                { key: "tests",        label: "test_connector.py" },
                                { key: "requirements", label: "requirements.txt" },
                                { key: "readme",       label: "README.md" },
                              ] as const).map(({ key, label }) => (
                                <button
                                  key={key}
                                  onClick={() => setBundleFileTab(key)}
                                  className={`px-3 py-1 rounded text-xs font-mono font-bold transition-all
                                    ${bundleFileTab === key
                                      ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm"
                                      : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"}`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                            <pre className="p-4 text-xs font-mono text-slate-700 dark:text-slate-350 whitespace-pre-wrap break-all bg-slate-50 dark:bg-slate-950 max-h-80 overflow-y-auto">
                              {bundleFileTab === "connector"    ? bundle.connector_code
                                : bundleFileTab === "agent_def"   ? bundle.agent_def_yaml
                                : bundleFileTab === "tests"        ? bundle.test_code
                                : bundleFileTab === "requirements" ? bundle.requirements
                                : bundle.readme}
                            </pre>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
