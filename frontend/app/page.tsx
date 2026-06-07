"use client"

import { useState, useCallback, useRef, useEffect } from "react"
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
// State machines
// ---------------------------------------------------------------------------

type L1State =
  | { phase: "idle" }
  | { phase: "processing"; logs: string[] }
  | { phase: "done"; result: DiscoveryResult; logs: string[] }
  | { phase: "error"; message: string; logs: string[] }

type L2State =
  | { phase: "idle" }
  | { phase: "processing"; logs: string[] }
  | { phase: "done"; report: GapReport; logs: string[] }
  | { phase: "error"; message: string; logs: string[] }

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
  | { phase: "processing"; logs: string[] }
  | { phase: "done"; bundles: GeneratedBundle[]; logs: string[] }
  | { phase: "error"; message: string; logs: string[] }

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const CRITICALITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-800",
  high: "bg-orange-100 text-orange-800",
  medium: "bg-yellow-100 text-yellow-800",
  low: "bg-green-100 text-green-800",
  unknown: "bg-slate-100 text-slate-600",
}

const EFFORT_COLORS: Record<string, string> = {
  S: "bg-green-100 text-green-800",
  M: "bg-yellow-100 text-yellow-800",
  L: "bg-orange-100 text-orange-800",
  XL: "bg-red-100 text-red-800",
}

const EFFORT_LABELS: Record<string, string> = {
  S: "1–3 days",
  M: "1–2 weeks",
  L: "3–6 weeks",
  XL: "2+ months",
}

const STATUS_COLORS: Record<string, string> = {
  available: "bg-green-100 text-green-800",
  missing: "bg-red-100 text-red-800",
}

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      {text}
    </span>
  )
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value)
  const color = pct >= 80 ? "bg-green-500" : pct >= 60 ? "bg-yellow-500" : "bg-red-500"
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-500 w-8 text-right">{pct}%</span>
    </div>
  )
}

function LogPanel({ logs, active, label }: { logs: string[]; active: boolean; label: string }) {
  const [open, setOpen] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [logs, open])

  if (!logs.length) return null

  return (
    <div className="bg-slate-900 rounded-xl overflow-hidden border border-slate-700">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left"
      >
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${active ? "bg-green-400 animate-pulse" : "bg-slate-500"}`} />
          <span className="text-xs font-mono text-slate-300">
            {label} — {logs.length} line{logs.length !== 1 ? "s" : ""}
          </span>
        </div>
        <svg
          className={`w-4 h-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-4 pb-4 max-h-56 overflow-y-auto font-mono text-xs leading-5 space-y-0.5">
          {logs.map((line, i) => (
            <div key={i} className="text-slate-300 whitespace-pre-wrap break-all">{line}</div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
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
  // Level 1 state
  const [files, setFiles] = useState<File[]>([])
  const [l1State, setL1State] = useState<L1State>({ phase: "idle" })
  const [activeTab, setActiveTab] = useState<"systems" | "relationships">("systems")

  // Level 2 state
  const [l2State, setL2State] = useState<L2State>({ phase: "idle" })
  const [useCaseText, setUseCaseText] = useState("")
  const [l2Tab, setL2Tab] = useState<"gaps" | "dependencies" | "skipped">("gaps")

  // Level 3 state
  const [l3State, setL3State] = useState<L3State>({ phase: "idle" })
  const [expandedBundle, setExpandedBundle] = useState<number | null>(null)
  const [bundleFileTab, setBundleFileTab] = useState<"connector" | "agent_def" | "tests" | "requirements" | "readme">("connector")

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
  // Level 1 — discover systems
  // -------------------------------------------------------------------------
  const runDiscovery = async () => {
    if (!files.length) return
    setL1State({ phase: "processing", logs: [] })
    setL2State({ phase: "idle" })

    const form = new FormData()
    files.forEach((f) => form.append("files", f))

    try {
      const res = await fetch("/api/discover", { method: "POST", body: form })
      if (!res.ok || !res.body) {
        const data = await res.json()
        setL1State({ phase: "error", message: data.error ?? "Request failed", logs: [] })
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
          let event: { type: string; message?: string; data?: DiscoveryResult }
          try { event = JSON.parse(line.slice(6)) } catch { continue }

          if (event.type === "log" && event.message) {
            setL1State((prev) =>
              prev.phase === "processing"
                ? { ...prev, logs: [...prev.logs, event.message!] }
                : prev
            )
          } else if (event.type === "result" && event.data) {
            setL1State((prev) => ({
              phase: "done",
              result: event.data!,
              logs: prev.phase === "processing" ? prev.logs : [],
            }))
          } else if (event.type === "error" && event.message) {
            setL1State((prev) => ({
              phase: "error",
              message: event.message!,
              logs: prev.phase === "processing" ? prev.logs : [],
            }))
          }
        }
      }
    } catch (err: unknown) {
      setL1State((prev) => ({
        phase: "error",
        message: err instanceof Error ? err.message : "Unknown error",
        logs: prev.phase === "processing" ? prev.logs : [],
      }))
    }
  }

  // -------------------------------------------------------------------------
  // Level 2 — gap analysis
  // -------------------------------------------------------------------------
  const runGapAnalysis = async () => {
    if (l1State.phase !== "done" || !useCaseText.trim()) return
    setL2State({ phase: "processing", logs: [] })

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inventory: l1State.result,
          use_cases: useCaseText,
        }),
      })

      if (!res.ok || !res.body) {
        const data = await res.json()
        setL2State({ phase: "error", message: data.error ?? "Request failed", logs: [] })
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
          let event: { type: string; message?: string; data?: GapReport }
          try { event = JSON.parse(line.slice(6)) } catch { continue }

          if (event.type === "log" && event.message) {
            setL2State((prev) =>
              prev.phase === "processing"
                ? { ...prev, logs: [...prev.logs, event.message!] }
                : prev
            )
          } else if (event.type === "result" && event.data) {
            setL2State((prev) => ({
              phase: "done",
              report: event.data!,
              logs: prev.phase === "processing" ? prev.logs : [],
            }))
          } else if (event.type === "error" && event.message) {
            setL2State((prev) => ({
              phase: "error",
              message: event.message!,
              logs: prev.phase === "processing" ? prev.logs : [],
            }))
          }
        }
      }
    } catch (err: unknown) {
      setL2State((prev) => ({
        phase: "error",
        message: err instanceof Error ? err.message : "Unknown error",
        logs: prev.phase === "processing" ? prev.logs : [],
      }))
    }
  }

  // -------------------------------------------------------------------------
  // Level 3 — connector generation
  // -------------------------------------------------------------------------
  const runGenerate = async () => {
    if (l1State.phase !== "done" || l2State.phase !== "done") return
    setL3State({ phase: "processing", logs: [] })
    setExpandedBundle(null)

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inventory: l1State.result,
          gap_report: l2State.report,
        }),
      })

      if (!res.ok || !res.body) {
        const data = await res.json()
        setL3State({ phase: "error", message: data.error ?? "Request failed", logs: [] })
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

          if (event.type === "log" && event.message) {
            setL3State((prev) =>
              prev.phase === "processing"
                ? { ...prev, logs: [...prev.logs, event.message!] }
                : prev
            )
          } else if (event.type === "result" && event.data) {
            setL3State((prev) => ({
              phase: "done",
              bundles: event.data!.bundles,
              logs: prev.phase === "processing" ? prev.logs : [],
            }))
          } else if (event.type === "error" && event.message) {
            setL3State((prev) => ({
              phase: "error",
              message: event.message!,
              logs: prev.phase === "processing" ? prev.logs : [],
            }))
          }
        }
      }
    } catch (err: unknown) {
      setL3State((prev) => ({
        phase: "error",
        message: err instanceof Error ? err.message : "Unknown error",
        logs: prev.phase === "processing" ? prev.logs : [],
      }))
    }
  }

  const l1Logs =
    l1State.phase === "processing" || l1State.phase === "done" || l1State.phase === "error"
      ? l1State.logs : []
  const l1Result = l1State.phase === "done" ? l1State.result : null

  const l2Logs =
    l2State.phase === "processing" || l2State.phase === "done" || l2State.phase === "error"
      ? l2State.logs : []
  const l2Report = l2State.phase === "done" ? l2State.report : null

  const l3Logs =
    l3State.phase === "processing" || l3State.phase === "done" || l3State.phase === "error"
      ? l3State.logs : []
  const l3Bundles = l3State.phase === "done" ? l3State.bundles : null

  return (
    <main className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
          <span className="text-white text-sm font-bold">A</span>
        </div>
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Aivar Discovery Agent</h1>
          <p className="text-xs text-slate-500">Enterprise system discovery &amp; integration gap analysis</p>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* ---------------------------------------------------------------- */}
        {/* LEVEL 1 — System Discovery                                        */}
        {/* ---------------------------------------------------------------- */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">
            Level 1 — System Discovery
          </h2>
        </div>

        {/* Upload zone */}
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors
            ${isDragActive
              ? "border-brand-500 bg-brand-50"
              : "border-slate-300 bg-white hover:border-brand-400 hover:bg-slate-50"
            }`}
        >
          <input {...getInputProps()} />
          <div className="flex flex-col items-center gap-2 text-slate-500">
            <svg className="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="font-medium text-slate-700">
              {isDragActive ? "Drop files here" : "Drop files or click to browse"}
            </p>
            <p className="text-sm">PDF, DOCX, PPTX, XLSX, CSV, MD, TXT, PNG, JPG</p>
          </div>
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
            {files.map((f) => (
              <div key={f.name} className="flex items-center px-4 py-3 gap-3">
                <span className="text-xs font-mono bg-slate-100 px-2 py-0.5 rounded text-slate-600 uppercase">
                  {f.name.split(".").pop()}
                </span>
                <span className="flex-1 text-sm text-slate-700 truncate">{f.name}</span>
                <span className="text-xs text-slate-400">{(f.size / 1024).toFixed(1)} KB</span>
                <button
                  onClick={() => removeFile(f.name)}
                  className="text-slate-400 hover:text-red-500 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-4">
          <button
            onClick={runDiscovery}
            disabled={!files.length || l1State.phase === "processing"}
            className="px-5 py-2.5 bg-brand-600 text-white rounded-lg font-medium hover:bg-brand-700
              disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {l1State.phase === "processing" ? "Analyzing…" : "Discover Systems"}
          </button>
          {(l1State.phase === "done" || l1State.phase === "error") && (
            <button
              onClick={() => {
                setL1State({ phase: "idle" })
                setL2State({ phase: "idle" })
                setFiles([])
                setUseCaseText("")
              }}
              className="px-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition-colors"
            >
              Reset
            </button>
          )}
        </div>

        {/* L1 log panel */}
        <LogPanel logs={l1Logs} active={l1State.phase === "processing"} label="Discovery logs" />

        {/* L1 error */}
        {l1State.phase === "error" && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            <strong>Error:</strong> {l1State.message}
          </div>
        )}

        {/* L1 results */}
        {l1Result && (
          <div className="space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: "Documents", value: l1Result.total_documents_processed },
                { label: "Systems Found", value: l1Result.total_systems_found },
                { label: "Relationships", value: l1Result.graph_stats.total_edges },
                { label: "Flagged for Review", value: l1Result.systems_flagged_for_review },
              ].map(({ label, value }) => (
                <div key={label} className="bg-white rounded-xl border border-slate-200 p-4">
                  <p className="text-2xl font-bold text-slate-900">{value}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{label}</p>
                </div>
              ))}
            </div>

            {/* Download L1 */}
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
                className="flex items-center gap-2 px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download Inventory JSON
              </button>
            </div>

            {/* L1 tabs */}
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
              {(["systems", "relationships"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize
                    ${activeTab === tab ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Systems table */}
            {activeTab === "systems" && (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left">
                      <th className="px-4 py-3 font-medium text-slate-600">System</th>
                      <th className="px-4 py-3 font-medium text-slate-600">Category</th>
                      <th className="px-4 py-3 font-medium text-slate-600">Criticality</th>
                      <th className="px-4 py-3 font-medium text-slate-600 w-40">Confidence</th>
                      <th className="px-4 py-3 font-medium text-slate-600 text-center">Mentions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {l1Result.systems.map((sys, i) => (
                      <tr key={`${sys.canonical_name}-${i}`} className={sys.needs_human_review ? "bg-amber-50" : "hover:bg-slate-50"}>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">{sys.canonical_name}</div>
                          {sys.needs_human_review && sys.review_note && (
                            <div className="text-xs text-amber-700 mt-0.5">{sys.review_note}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{sys.category}</td>
                        <td className="px-4 py-3">
                          <Badge
                            text={sys.criticality}
                            color={CRITICALITY_COLORS[sys.criticality] ?? CRITICALITY_COLORS.unknown}
                          />
                        </td>
                        <td className="px-4 py-3"><ConfidenceBar value={sys.confidence} /></td>
                        <td className="px-4 py-3 text-slate-600 text-center">{sys.mention_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {l1Result.systems.length === 0 && (
                  <div className="px-4 py-8 text-center text-sm text-slate-400">No systems found</div>
                )}
              </div>
            )}

            {/* Relationships table */}
            {activeTab === "relationships" && (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left">
                      <th className="px-4 py-3 font-medium text-slate-600">Source</th>
                      <th className="px-4 py-3 font-medium text-slate-600">Relation</th>
                      <th className="px-4 py-3 font-medium text-slate-600">Target</th>
                      <th className="px-4 py-3 font-medium text-slate-600 w-32">Confidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {l1Result.relationships.map((rel, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-900">{rel.source}</td>
                        <td className="px-4 py-3">
                          <span className="text-xs bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full font-mono">
                            {rel.relation}
                          </span>
                          <span className="ml-2 text-xs text-slate-400">{rel.direction}</span>
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">{rel.target}</td>
                        <td className="px-4 py-3"><ConfidenceBar value={rel.confidence} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {l1Result.relationships.length === 0 && (
                  <div className="px-4 py-8 text-center text-sm text-slate-400">No relationships found</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* LEVEL 2 — Gap Analysis (appears after L1 completes)               */}
        {/* ---------------------------------------------------------------- */}
        {l1State.phase === "done" && (
          <>
            {/* Divider */}
            <div className="flex items-center gap-4 pt-2">
              <div className="flex-1 h-px bg-slate-200" />
              <span className="text-xs text-slate-400 font-medium uppercase tracking-wider whitespace-nowrap">
                Level 2 — Integration Gap Analysis
              </span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>

            {/* Use case input */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
              <p className="text-sm text-slate-600">
                Describe your automation goals below — one per line. The agent will map
                each to the discovered systems, identify missing integrations, and
                prioritise the gaps for you.
              </p>
              <textarea
                value={useCaseText}
                onChange={(e) => setUseCaseText(e.target.value)}
                disabled={l2State.phase === "processing"}
                placeholder={
                  "Sync new leads from the website to the CRM automatically\n" +
                  "Auto-generate invoices when a deal is marked closed-won\n" +
                  "Send order confirmation emails via the communication platform"
                }
                rows={5}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800
                  placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500
                  disabled:bg-slate-50 disabled:text-slate-400 resize-none font-mono"
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={runGapAnalysis}
                  disabled={!useCaseText.trim() || l2State.phase === "processing"}
                  className="px-5 py-2.5 bg-brand-600 text-white rounded-lg font-medium hover:bg-brand-700
                    disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {l2State.phase === "processing" ? "Analysing gaps…" : "Analyse Integration Gaps"}
                </button>
                {(l2State.phase === "done" || l2State.phase === "error") && (
                  <button
                    onClick={() => { setL2State({ phase: "idle" }); setUseCaseText("") }}
                    className="px-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* L2 log panel */}
            <LogPanel logs={l2Logs} active={l2State.phase === "processing"} label="Gap analysis logs" />

            {/* L2 error */}
            {l2State.phase === "error" && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
                <strong>Error:</strong> {l2State.message}
              </div>
            )}

            {/* L2 results */}
            {l2Report && (
              <div className="space-y-6">
                {/* L2 stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { label: "Use Cases Mapped", value: l2Report.use_cases_analyzed },
                    { label: "Total Integration Checks", value: l2Report.total_gaps },
                    { label: "Missing / Partial", value: l2Report.missing_integrations },
                    { label: "Unmapped Use Cases", value: l2Report.skipped.unmapped_use_cases.length },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-white rounded-xl border border-slate-200 p-4">
                      <p className="text-2xl font-bold text-slate-900">{value}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>

                {/* Download L2 */}
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
                    className="flex items-center gap-2 px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download Gap Report JSON
                  </button>
                </div>

                {/* L2 tabs */}
                <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
                  {([
                    { key: "gaps", label: `Gaps (${l2Report.gaps.length})` },
                    { key: "dependencies", label: `Dependencies (${l2Report.dependency_graph.length})` },
                    { key: "skipped", label: `Skipped (${l2Report.skipped.unmapped_use_cases.length + l2Report.skipped.rejected_systems.length})` },
                  ] as const).map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setL2Tab(key)}
                      className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors
                        ${l2Tab === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Gaps table */}
                {l2Tab === "gaps" && (
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-left">
                          <th className="px-4 py-3 font-medium text-slate-600">Integration</th>
                          <th className="px-4 py-3 font-medium text-slate-600">Status</th>
                          <th className="px-4 py-3 font-medium text-slate-600">Effort</th>
                          <th className="px-4 py-3 font-medium text-slate-600 text-center">Blocked</th>
                          <th className="px-4 py-3 font-medium text-slate-600 text-right">Priority</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {l2Report.gaps.map((gap, i) => (
                          <tr key={i} className={gap.status === "missing" ? "bg-red-50/40" : "hover:bg-slate-50"}>
                            <td className="px-4 py-3">
                              <div className="font-medium text-slate-900">
                                {gap.source_system} → {gap.destination_system}
                              </div>
                              {gap.entities.length > 0 && (
                                <div className="text-xs text-slate-500 mt-0.5">
                                  {gap.entities.join(", ")}
                                </div>
                              )}
                              {gap.effort_rationale && (
                                <div className="text-xs text-slate-400 mt-1 italic">{gap.effort_rationale}</div>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <Badge
                                text={gap.status}
                                color={STATUS_COLORS[gap.status] ?? "bg-slate-100 text-slate-600"}
                              />
                            </td>
                            <td className="px-4 py-3">
                              {gap.effort ? (
                                <div className="flex flex-col gap-0.5">
                                  <Badge
                                    text={gap.effort}
                                    color={EFFORT_COLORS[gap.effort] ?? "bg-slate-100 text-slate-600"}
                                  />
                                  <span className="text-xs text-slate-400">{EFFORT_LABELS[gap.effort]}</span>
                                </div>
                              ) : (
                                <span className="text-xs text-slate-400">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-center text-slate-600">
                              {gap.use_cases_blocked.length}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-sm text-slate-700">
                              {gap.priority_score.toFixed(0)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {l2Report.gaps.length === 0 && (
                      <div className="px-4 py-8 text-center text-sm text-slate-400">
                        No integration gaps detected
                      </div>
                    )}
                  </div>
                )}

                {/* Dependencies table */}
                {l2Tab === "dependencies" && (
                  <div className="space-y-3">
                    {l2Report.dependency_graph.length === 0 ? (
                      <div className="bg-white rounded-xl border border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
                        No blocking dependencies
                      </div>
                    ) : (
                      l2Report.dependency_graph.map((dep, i) => (
                        <div key={i} className="bg-white rounded-xl border border-slate-200 p-4">
                          <div className="flex items-start gap-3">
                            <span className="mt-0.5 px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-xs font-mono whitespace-nowrap">
                              {dep.integration}
                            </span>
                            <div className="flex-1">
                              <p className="text-xs text-slate-500 mb-1 font-medium">must exist before:</p>
                              <ul className="space-y-1">
                                {dep.required_before.map((uc, j) => (
                                  <li key={j} className="text-sm text-slate-700 flex items-start gap-1.5">
                                    <span className="text-slate-400 mt-0.5">•</span>
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

                {/* Skipped panel */}
                {l2Tab === "skipped" && (
                  <div className="space-y-4">
                    {l2Report.skipped.unmapped_use_cases.length > 0 && (
                      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                          <p className="text-sm font-medium text-slate-700">Unmapped use cases</p>
                        </div>
                        <div className="divide-y divide-slate-100">
                          {l2Report.skipped.unmapped_use_cases.map((item, i) => (
                            <div key={i} className="px-4 py-3">
                              <p className="text-sm text-slate-800">{item.text}</p>
                              <p className="text-xs text-slate-500 mt-0.5">{item.reason}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {l2Report.skipped.rejected_systems.length > 0 && (
                      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                          <p className="text-sm font-medium text-slate-700">Rejected systems (not in inventory)</p>
                        </div>
                        <div className="divide-y divide-slate-100">
                          {l2Report.skipped.rejected_systems.map((item, i) => (
                            <div key={i} className="px-4 py-3">
                              <p className="text-sm text-slate-800 font-medium">{item.system}</p>
                              <p className="text-xs text-slate-500">{item.use_case}</p>
                              <p className="text-xs text-slate-400 mt-0.5">{item.reason}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {l2Report.skipped.missing_capabilities.length > 0 && (
                      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                          <p className="text-sm font-medium text-slate-700">Missing capabilities (needed but not in inventory)</p>
                        </div>
                        <div className="divide-y divide-slate-100">
                          {l2Report.skipped.missing_capabilities.map((item, i) => (
                            <div key={i} className="px-4 py-3">
                              <p className="text-sm text-slate-800">{item.capability_needed}</p>
                              <p className="text-xs text-slate-500">{item.use_case}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {l2Report.skipped.unmapped_use_cases.length === 0 &&
                      l2Report.skipped.rejected_systems.length === 0 &&
                      l2Report.skipped.missing_capabilities.length === 0 && (
                      <div className="bg-white rounded-xl border border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
                        Nothing was skipped — all use cases were mapped successfully
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ---------------------------------------------------------------- */}
            {/* LEVEL 3 — Connector Generation (when missing integrations exist)  */}
            {/* ---------------------------------------------------------------- */}
            {l2Report && l2Report.missing_integrations > 0 && (
              <>
                {/* Divider */}
                <div className="flex items-center gap-4 pt-2">
                  <div className="flex-1 h-px bg-slate-200" />
                  <span className="text-xs text-slate-400 font-medium uppercase tracking-wider whitespace-nowrap">
                    Level 3 — Connector Generation
                  </span>
                  <div className="flex-1 h-px bg-slate-200" />
                </div>

                {/* Generate button */}
                <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                  <p className="text-sm text-slate-600">
                    Generate connector modules, agent definitions, and unit tests for each missing integration.
                    Each bundle is validated automatically — syntax check, YAML structure, and live test run.
                  </p>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={runGenerate}
                      disabled={l3State.phase === "processing"}
                      className="px-5 py-2.5 bg-brand-600 text-white rounded-lg font-medium hover:bg-brand-700
                        disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {l3State.phase === "processing" ? "Generating…" : "Generate Connectors"}
                    </button>
                    {(l3State.phase === "done" || l3State.phase === "error") && (
                      <button
                        onClick={() => { setL3State({ phase: "idle" }); setExpandedBundle(null) }}
                        className="px-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition-colors"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                {/* L3 log panel */}
                <LogPanel logs={l3Logs} active={l3State.phase === "processing"} label="Generation logs" />

                {/* L3 error */}
                {l3State.phase === "error" && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
                    <strong>Error:</strong> {l3State.message}
                  </div>
                )}

                {/* L3 bundles */}
                {l3Bundles && l3Bundles.length > 0 && (
                  <div className="space-y-4">
                    {/* Summary + Download All */}
                    <div className="flex flex-wrap items-start gap-4">
                      <div className="grid grid-cols-4 gap-4 flex-1">
                        {[
                          { label: "Bundles", value: l3Bundles.length, color: "text-slate-900" },
                          { label: "Passed Validation", value: l3Bundles.filter(b => !b.manual_setup_required && b.validation.valid).length, color: "text-green-700" },
                          { label: "Failed Validation", value: l3Bundles.filter(b => !b.manual_setup_required && !b.validation.valid).length, color: "text-red-700" },
                          { label: "Manual Setup", value: l3Bundles.filter(b => b.manual_setup_required).length, color: "text-amber-700" },
                        ].map(({ label, value, color }) => (
                          <div key={label} className="bg-white rounded-xl border border-slate-200 p-4">
                            <p className={`text-2xl font-bold ${color}`}>{value}</p>
                            <p className="text-xs text-slate-500 mt-0.5">{label}</p>
                          </div>
                        ))}
                      </div>
                      {l3Bundles.some(b => !b.manual_setup_required) && (
                        <button
                          onClick={() => downloadAllBundles(l3Bundles.filter(b => !b.manual_setup_required))}
                          className="flex items-center gap-2 px-4 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors whitespace-nowrap"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          Download All (.zip)
                        </button>
                      )}
                    </div>

                    {/* Bundle cards */}
                    {l3Bundles.map((bundle, i) => (
                      <div key={i} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                        {/* Header */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                          <div className="font-medium text-slate-900">{bundle.gap_key}</div>
                          <div className="flex items-center gap-2">
                            {bundle.manual_setup_required
                              ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">MANUAL SETUP</span>
                              : bundle.validation.valid
                                ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">VALID</span>
                                : <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">INVALID</span>
                            }
                            {!bundle.manual_setup_required && (
                              <button
                                onClick={() => downloadBundle(bundle)}
                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border border-slate-300 text-slate-600 hover:bg-slate-100 transition-colors"
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

                        {/* Paradigm note — shown instead of validation checks for manual bundles */}
                        {bundle.manual_setup_required && bundle.paradigm_notes && (
                          <div className="px-4 py-3 bg-amber-50 border-b border-slate-100">
                            <p className="text-xs font-semibold text-amber-800 mb-1">
                              Why auto-generation was skipped ({bundle.paradigm.replace('_', ' ')}):
                            </p>
                            <p className="text-xs text-amber-700 leading-relaxed whitespace-pre-wrap">
                              {bundle.paradigm_notes}
                            </p>
                          </div>
                        )}

                        {/* Validation checks — only shown for REST connectors */}
                        {!bundle.manual_setup_required && (
                          <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 border-b border-slate-100">
                            {[
                              { label: "Compiles", ok: bundle.validation.connector_compiles },
                              { label: "Imports", ok: bundle.validation.connector_imports },
                              { label: "YAML valid", ok: bundle.validation.agent_def_valid },
                              { label: "Tests pass", ok: bundle.validation.tests_pass },
                            ].map(({ label, ok }) => (
                              <div key={label} className="flex items-center gap-1.5 text-xs">
                                <span className={ok ? "text-green-600 font-bold" : "text-red-500 font-bold"}>
                                  {ok ? "✓" : "✗"}
                                </span>
                                <span className={ok ? "text-slate-700" : "text-slate-400"}>{label}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Failure details */}
                        {!bundle.manual_setup_required && bundle.validation.failures.length > 0 && (
                          <div className="px-4 py-3 bg-red-50 border-b border-slate-100">
                            <p className="text-xs font-medium text-red-700 mb-1.5">Failure details:</p>
                            <ul className="space-y-1">
                              {bundle.validation.failures.map((f, j) => (
                                <li key={j} className="text-xs text-red-600 font-mono whitespace-pre-wrap break-all">{f}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* File viewer toggle — only for REST connectors with generated code */}
                        {!bundle.manual_setup_required && (
                          <>
                            <button
                              onClick={() => {
                                setExpandedBundle(expandedBundle === i ? null : i)
                                setBundleFileTab("connector")
                              }}
                              className="w-full px-4 py-2.5 text-left flex items-center justify-between text-xs text-slate-500 hover:bg-slate-50 transition-colors"
                            >
                              <span className="font-medium">View generated files</span>
                              <svg
                                className={`w-4 h-4 transition-transform ${expandedBundle === i ? "rotate-180" : ""}`}
                                fill="none" stroke="currentColor" viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>

                            {expandedBundle === i && (
                              <div className="border-t border-slate-100">
                                <div className="flex flex-wrap gap-0.5 bg-slate-100 p-1">
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
                                      className={`px-3 py-1 rounded text-xs font-mono transition-colors
                                        ${bundleFileTab === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                                    >
                                      {label}
                                    </button>
                                  ))}
                                </div>
                                <pre className="p-4 text-xs font-mono text-slate-700 whitespace-pre-wrap break-all bg-slate-50 max-h-80 overflow-y-auto">
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
              </>
            )}
          </>
        )}
      </div>
    </main>
  )
}
