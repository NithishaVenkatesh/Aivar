"use client"

import { useState, useCallback, useEffect, useMemo, useRef } from "react"
import { useDropzone } from "react-dropzone"
import { createZip, downloadZip } from "../lib/zip"

// ---------------------------------------------------------------------------
// Types — Level 1
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
// Types — Level 2
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
// Types — Level 3
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

// ---------------------------------------------------------------------------
// State machines — no log arrays (logs go to server terminal)
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

type L3State =
  | { phase: "idle" }
  | { phase: "processing" }
  | { phase: "done"; bundles: GeneratedBundle[] }
  | { phase: "error"; message: string }

// ---------------------------------------------------------------------------
// Display constants
// ---------------------------------------------------------------------------

const CRITICALITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-300 border border-red-200/50 dark:border-red-800/40",
  high: "bg-orange-100 dark:bg-orange-950/40 text-orange-800 dark:text-orange-300 border border-orange-200/50 dark:border-orange-800/40",
  medium: "bg-yellow-100 dark:bg-yellow-950/40 text-yellow-800 dark:text-yellow-300 border border-yellow-200/50 dark:border-yellow-800/40",
  low: "bg-green-100 dark:bg-green-950/40 text-green-800 dark:text-green-300 border border-green-200/50 dark:border-green-800/40",
  unknown: "bg-slate-100 dark:bg-zinc-900 text-slate-600 dark:text-zinc-400 border border-slate-200/50 dark:border-zinc-800",
}

const EFFORT_COLORS: Record<string, string> = {
  S: "bg-green-100 dark:bg-green-950/40 text-green-800 dark:text-green-300 border border-green-200/50 dark:border-green-800/40",
  M: "bg-yellow-100 dark:bg-yellow-950/40 text-yellow-800 dark:text-yellow-300 border border-yellow-200/50 dark:border-yellow-800/40",
  L: "bg-orange-100 dark:bg-orange-950/40 text-orange-800 dark:text-orange-300 border border-orange-200/50 dark:border-orange-800/40",
  XL: "bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-300 border border-red-200/50 dark:border-red-800/40",
}

const EFFORT_LABELS: Record<string, string> = {
  S: "1 to 3 days",
  M: "1 to 2 weeks",
  L: "3 to 6 weeks",
  XL: "2 or more months",
}

const STATUS_COLORS: Record<string, string> = {
  available: "bg-green-100 dark:bg-green-950/40 text-green-800 dark:text-green-300 border border-green-200/50 dark:border-green-800/40",
  missing: "bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-300 border border-red-200/50 dark:border-red-800/40",
}

// (timer-based message cycling removed — status now driven by real backend events)

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
      <div className="flex-1 h-1.5 bg-slate-200 dark:bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-500 dark:text-zinc-500 w-8 text-right font-mono">{pct}%</span>
    </div>
  )
}

function ProcessingFeed({ feed, defaultMsg }: { feed: string[]; defaultMsg: string }) {
  const latest = feed.length > 0 ? feed[feed.length - 1] : defaultMsg
  const history = feed.length > 1 ? feed.slice(0, -1).slice(-4).reverse() : []

  return (
    <div className="bg-white dark:bg-zinc-950 rounded-xl border border-slate-200 dark:border-zinc-900 px-5 py-5 shadow-sm">
      <div className="flex items-center gap-4">
        <div className="relative flex items-center justify-center shrink-0">
          <span className="absolute inline-flex h-10 w-10 rounded-full bg-brand-500/20 dark:bg-brand-400/15 agentic-pulse" />
          <div className="relative w-10 h-10 rounded-full bg-gradient-to-tr from-brand-500 to-brand-700 flex items-center justify-center shadow-sm">
            <svg className="w-5 h-5 text-white animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 dark:text-zinc-100">{latest}</p>
          <p className="text-xs text-slate-400 dark:text-zinc-600 mt-0.5">This may take a few minutes</p>
        </div>
      </div>
      {history.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-zinc-900 pl-14 space-y-1.5">
          {history.map((msg, i) => (
            <p key={i} className="text-xs text-slate-400 dark:text-zinc-500 flex items-center gap-2">
              <span className="text-green-500 dark:text-green-400 font-bold shrink-0">&#10003;</span>
              {msg}
            </p>
          ))}
        </div>
      )}
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
        <p className="text-sm font-semibold text-red-700 dark:text-red-300">We ran into a problem</p>
        <p className="text-sm text-red-600 dark:text-red-400 mt-0.5">{message}</p>
        <p className="text-xs text-red-400 dark:text-red-600 mt-1">Please try again. If this keeps happening, contact support.</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Network graph (L1 connections visual)
// ---------------------------------------------------------------------------

const CRIT_COLOR: Record<string, string> = {
  critical: "#ef4444",
  high:     "#f97316",
  medium:   "#eab308",
  low:      "#22c55e",
  unknown:  "#71717a",
}

function SystemGraph({
  systems,
  relationships,
}: {
  systems: SystemNode[]
  relationships: SystemRelationship[]
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerW, setContainerW] = useState(700)
  const [tooltip, setTooltip] = useState<{ sys: SystemNode; x: number; y: number } | null>(null)
  const GH = 460

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    setContainerW(el.clientWidth || 700)
    const ro = new ResizeObserver(() => setContainerW(el.clientWidth || 700))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const W = containerW

  // Force-directed layout — runs synchronously (fast for typical enterprise graphs < 40 nodes)
  const positions = useMemo(() => {
    if (!systems.length) return new Map<string, { x: number; y: number }>()
    const n = systems.length
    const pos = new Map<string, { x: number; y: number; vx: number; vy: number }>()

    // Seed on a circle
    systems.forEach((s, i) => {
      const angle = (2 * Math.PI * i) / n - Math.PI / 2
      const r = Math.min(W, GH) * 0.32
      pos.set(s.canonical_name, {
        x: W / 2 + r * Math.cos(angle),
        y: GH / 2 + r * Math.sin(angle),
        vx: 0, vy: 0,
      })
    })

    const REPULSION = 2800
    const ATTRACTION = 0.04
    const IDEAL_DIST = 130
    const DAMPING = 0.78

    for (let iter = 0; iter < 260; iter++) {
      const ids = Array.from(pos.keys())
      // Repulsion between every pair
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = pos.get(ids[i])!
          const b = pos.get(ids[j])!
          const dx = b.x - a.x || 0.1
          const dy = b.y - a.y || 0.1
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const f = REPULSION / (dist * dist)
          const fx = (dx / dist) * f
          const fy = (dy / dist) * f
          a.vx -= fx; a.vy -= fy
          b.vx += fx; b.vy += fy
        }
      }
      // Spring attraction along edges
      relationships.forEach(rel => {
        const a = pos.get(rel.source)
        const b = pos.get(rel.target)
        if (!a || !b) return
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const stretch = dist - IDEAL_DIST
        const f = stretch * ATTRACTION
        const fx = (dx / dist) * f
        const fy = (dy / dist) * f
        a.vx += fx; a.vy += fy
        b.vx -= fx; b.vy -= fy
      })
      // Gentle gravity toward center
      pos.forEach(p => {
        p.vx += (W / 2 - p.x) * 0.003
        p.vy += (GH / 2 - p.y) * 0.003
        p.vx *= DAMPING
        p.vy *= DAMPING
        p.x = Math.max(52, Math.min(W - 52, p.x + p.vx))
        p.y = Math.max(48, Math.min(GH - 48, p.y + p.vy))
      })
    }

    const result = new Map<string, { x: number; y: number }>()
    pos.forEach((v, k) => result.set(k, { x: v.x, y: v.y }))
    return result
  }, [systems, relationships, W])

  const nodeR = (sys: SystemNode) => Math.max(22, Math.min(40, 18 + sys.mention_count * 2.5))

  return (
    <div ref={containerRef} className="relative bg-white dark:bg-zinc-950 rounded-xl border border-slate-200 dark:border-zinc-900 overflow-hidden shadow-sm">
      <svg width="100%" height={GH} viewBox={`0 0 ${W} ${GH}`} style={{ display: "block" }}>
        <defs>
          <marker id="gph-arrow" markerWidth="7" markerHeight="7" refX="6.5" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7 Z" fill="#64748b" fillOpacity="0.55" />
          </marker>
        </defs>

        {/* Edges */}
        {relationships.map((rel, i) => {
          const from = positions.get(rel.source)
          const to   = positions.get(rel.target)
          if (!from || !to) return null
          const fromSys = systems.find(s => s.canonical_name === rel.source)
          const toSys   = systems.find(s => s.canonical_name === rel.target)
          if (!fromSys || !toSys) return null

          const dx = to.x - from.x
          const dy = to.y - from.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const rF = nodeR(fromSys)
          const rT = nodeR(toSys)
          // Trim endpoints to sit on node circumference
          const x1 = from.x + (dx / dist) * rF
          const y1 = from.y + (dy / dist) * rF
          const x2 = to.x   - (dx / dist) * (rT + 8)
          const y2 = to.y   - (dy / dist) * (rT + 8)
          // Slight curve perpendicular to edge direction
          const mx = (x1 + x2) / 2 + (dy / dist) * 20
          const my = (y1 + y2) / 2 - (dx / dist) * 20

          return (
            <path key={i}
              d={`M${x1},${y1} Q${mx},${my} ${x2},${y2}`}
              fill="none"
              stroke="#94a3b8"
              strokeWidth={1.5}
              strokeOpacity={0.38}
              markerEnd="url(#gph-arrow)"
            />
          )
        })}

        {/* Nodes */}
        {systems.map(sys => {
          const pos = positions.get(sys.canonical_name)
          if (!pos) return null
          const r     = nodeR(sys)
          const color = CRIT_COLOR[sys.criticality] ?? CRIT_COLOR.unknown
          const label = sys.canonical_name.length > 13
            ? sys.canonical_name.slice(0, 11) + "…"
            : sys.canonical_name

          return (
            <g key={sys.canonical_name}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setTooltip({ sys, x: pos.x, y: pos.y })}
              onMouseLeave={() => setTooltip(null)}>
              {/* Soft glow ring */}
              <circle cx={pos.x} cy={pos.y} r={r + 7} fill={color} fillOpacity={0.1} />
              {/* Main node */}
              <circle cx={pos.x} cy={pos.y} r={r} fill={color} fillOpacity={0.88} />
              {/* Label */}
              <text x={pos.x} y={pos.y + 4}
                textAnchor="middle"
                fill="white"
                fontSize={r > 30 ? 10 : 9}
                fontWeight="700"
                style={{ pointerEvents: "none", userSelect: "none" }}>
                {label}
              </text>
            </g>
          )
        })}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 shadow-xl pointer-events-none z-20 min-w-[148px]"
          style={{
            top: Math.max(8, tooltip.y - 70),
            ...(tooltip.x > W * 0.65
              ? { right: W - tooltip.x + 16 }
              : { left: tooltip.x + 16 }),
          }}>
          <p className="text-xs font-bold text-white">{tooltip.sys.canonical_name}</p>
          <p className="text-[11px] text-zinc-400 mt-0.5">{tooltip.sys.category}</p>
          <div className="mt-1.5 space-y-0.5">
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-zinc-500">Confidence</span>
              <span className="text-white font-semibold ml-auto">{Math.round(tooltip.sys.confidence)}%</span>
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-zinc-500">Mentions</span>
              <span className="text-white font-semibold ml-auto">{tooltip.sys.mention_count}</span>
            </div>
            {tooltip.sys.auth_method && (
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-zinc-500">Auth</span>
                <span className="text-white font-semibold ml-auto">{tooltip.sys.auth_method}</span>
              </div>
            )}
            {tooltip.sys.needs_human_review && (
              <p className="text-amber-400 text-[11px] mt-1">Needs review</p>
            )}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="px-4 py-2.5 border-t border-slate-100 dark:border-zinc-900 flex flex-wrap items-center gap-3">
        {(["critical", "high", "medium", "low", "unknown"] as const)
          .filter(lvl => systems.some(s => (s.criticality || "unknown") === lvl))
          .map(lvl => (
            <div key={lvl} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full block shrink-0"
                style={{ background: CRIT_COLOR[lvl] }} />
              <span className="text-[11px] text-slate-500 dark:text-zinc-500 capitalize">{lvl}</span>
            </div>
          ))}
        <p className="ml-auto text-[11px] text-slate-400 dark:text-zinc-600">
          {systems.length} systems &middot; {relationships.length} connections &middot; hover for details
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pipeline progress
// ---------------------------------------------------------------------------

type StageStatus = "idle" | "processing" | "done" | "error" | "skipped"

function PipelineProgress({
  stages,
}: {
  stages: Array<{ label: string; status: StageStatus; detail?: string }>
}) {
  return (
    <div className="bg-white dark:bg-zinc-950 rounded-xl border border-slate-200 dark:border-zinc-900 px-5 py-4 shadow-sm">
      {/* Equal-width grid — one column per stage */}
      <div className="grid" style={{ gridTemplateColumns: `repeat(${stages.length}, 1fr)` }}>
        {stages.map((stage, i) => {
          const { status } = stage
          const isDone    = status === "done"
          const isActive  = status === "processing"
          const isError   = status === "error"
          const isSkipped = status === "skipped"
          const prevDone  = i > 0 && stages[i - 1].status === "done"

          return (
            <div key={i} className="flex flex-col items-center">
              {/* Connector halves + bubble on a single row */}
              <div className="w-full flex items-center">
                {/* Left half-connector (invisible on first item) */}
                <div className={`flex-1 h-px transition-colors duration-300
                  ${i === 0 ? "invisible"
                  : prevDone ? "bg-green-300 dark:bg-green-900"
                  : "bg-slate-200 dark:bg-zinc-800"}`}
                />

                {/* Bubble */}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all duration-300
                  ${isDone    ? "bg-green-500 text-white"
                  : isActive  ? "bg-brand-600 text-white ring-4 ring-brand-100 dark:ring-brand-950/50"
                  : isError   ? "bg-red-500 text-white"
                  : isSkipped ? "bg-slate-200 dark:bg-zinc-800 text-slate-400 dark:text-zinc-600"
                  :             "bg-slate-200 dark:bg-zinc-800 text-slate-400 dark:text-zinc-600"}`}
                >
                  {isDone    ? "✓"
                  : isError  ? "✗"
                  : isActive ? <span className="animate-pulse">{i + 1}</span>
                  :            i + 1}
                </div>

                {/* Right half-connector (invisible on last item) */}
                <div className={`flex-1 h-px transition-colors duration-300
                  ${i === stages.length - 1 ? "invisible"
                  : isDone ? "bg-green-300 dark:bg-green-900"
                  : "bg-slate-200 dark:bg-zinc-800"}`}
                />
              </div>

              {/* Label — nowrap keeps it on one line */}
              <p className={`mt-1.5 text-xs font-semibold text-center whitespace-nowrap
                ${isDone    ? "text-slate-700 dark:text-zinc-300"
                : isActive  ? "text-brand-700 dark:text-brand-400"
                : isError   ? "text-red-600 dark:text-red-400"
                :             "text-slate-400 dark:text-zinc-600"}`}
              >
                {stage.label}
              </p>

              {/* Detail line */}
              {stage.detail && (
                <p className={`text-[10px] mt-0.5 text-center whitespace-nowrap font-medium
                  ${isDone    ? "text-slate-500 dark:text-zinc-500"
                  : isActive  ? "text-slate-500 dark:text-zinc-500"
                  : isError   ? "text-red-400 dark:text-red-500"
                  : isSkipped ? "text-slate-400 dark:text-zinc-600"
                  :             "text-slate-400 dark:text-zinc-600"}`}
                >
                  {stage.detail}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Download helpers
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
  downloadZip(createZip(bundles.flatMap(bundleFiles)), "integrations.zip")
}

function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
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

  const [l1Feed, setL1Feed] = useState<string[]>([])
  const [l2Feed, setL2Feed] = useState<string[]>([])
  const [l3Feed, setL3Feed] = useState<string[]>([])

  const [activeTab, setActiveTab] = useState<"systems" | "connections">("systems")
  const [l2Tab, setL2Tab] = useState<"gaps" | "order" | "unmatched">("gaps")
  const [expandedBundle, setExpandedBundle] = useState<number | null>(null)
  const [bundleFileTab, setBundleFileTab] = useState<"connector" | "agent_def" | "tests" | "requirements" | "readme">("connector")

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
    if (next === "dark") {
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
    }
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
    setL1Feed([])
    setL2Feed([])
    setL3Feed([])
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

          if (event.type === "log" && event.message) {
            setL1Feed(prev => [...prev, event.message as string])
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
    setL2Feed([])

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

          if (event.type === "log" && event.message) {
            setL2Feed(prev => [...prev, event.message as string])
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
    setL3Feed([])
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

          if (event.type === "log" && event.message) {
            setL3Feed(prev => [...prev, event.message as string])
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
    setL1Feed([])
    setL2Feed([])
    setL3Feed([])
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
      label: "Map Systems",
      status: l1State.phase as StageStatus,
      detail:
        l1State.phase === "done" ? `${l1Result?.total_systems_found ?? 0} systems found`
        : l1State.phase === "processing" ? "Scanning documents..."
        : l1State.phase === "error" ? "Could not complete"
        : undefined,
    },
    {
      label: "Find Gaps",
      status: l2State.phase as StageStatus,
      detail:
        l2State.phase === "done" ? `${l2Report?.missing_integrations ?? 0} gaps identified`
        : l2State.phase === "processing" ? "Reviewing goals..."
        : l2State.phase === "error" ? "Could not complete"
        : undefined,
    },
    {
      label: "Build",
      status: l3StageStatus(),
      detail:
        l3State.phase === "done" ? `${l3Bundles?.length ?? 0} integrations built`
        : l3State.phase === "processing" ? "Writing code..."
        : l3State.phase === "error" ? "Could not complete"
        : l3StageStatus() === "skipped" ? "Already connected"
        : undefined,
    },
  ]

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <main className="min-h-screen bg-slate-50 dark:bg-black text-slate-900 dark:text-white">

      {/* Header */}
      <header className="bg-white dark:bg-zinc-950 border-b border-slate-200 dark:border-zinc-900 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">Bridgent</h1>
          <p className="text-xs text-slate-400 dark:text-zinc-600 mt-0.5">Connect your business systems, automatically.</p>
        </div>

        {theme && (
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg border border-slate-200 dark:border-zinc-800 text-slate-500 dark:text-zinc-500 hover:bg-slate-100 dark:hover:bg-zinc-900 transition-colors bg-white dark:bg-zinc-950"
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

        {/* ------------------------------------------------------------------ */}
        {/* Input panel                                                          */}
        {/* ------------------------------------------------------------------ */}
        <div className="bg-white dark:bg-zinc-950 rounded-xl border border-slate-200 dark:border-zinc-900 overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-zinc-900 bg-slate-50/50 dark:bg-zinc-900/30">
            <h2 className="text-sm font-bold text-slate-800 dark:text-zinc-100">Start Your Analysis</h2>
            <p className="text-xs text-slate-500 dark:text-zinc-500 mt-0.5">
              Upload your company documents and describe what you want to automate. Bridgent will map your systems, find missing connections, and build the integrations for you.
            </p>
          </div>

          <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-5">

            {/* Left: documents */}
            <div className="space-y-3">
              <p className="text-xs font-bold text-slate-600 dark:text-zinc-400 uppercase tracking-wide">Your Documents</p>
              <p className="text-xs text-slate-400 dark:text-zinc-600">
                Contracts, process guides, architecture notes, org charts, anything that describes how your business operates and what tools you use.
              </p>

              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors duration-150
                  ${isDragActive
                    ? "border-brand-500 bg-brand-50/50 dark:bg-brand-950/20"
                    : "border-slate-300 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/40 hover:border-brand-400 dark:hover:border-zinc-700 hover:bg-white dark:hover:bg-zinc-900"
                  }
                  ${isRunning ? "pointer-events-none opacity-50" : ""}`}
              >
                <input {...getInputProps()} />
                <div className="flex flex-col items-center gap-2 text-slate-500">
                  <svg className="w-8 h-8 text-slate-400 dark:text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-sm font-semibold text-slate-700 dark:text-zinc-300">
                    {isDragActive ? "Drop your files here" : "Drop files here or click to browse"}
                  </p>
                  <p className="text-[11px] text-slate-400 dark:text-zinc-600">PDF, Word, PowerPoint, Excel, CSV, Markdown, Text, Images</p>
                </div>
              </div>

              {files.length > 0 && (
                <div className="rounded-lg border border-slate-200 dark:border-zinc-800 divide-y divide-slate-100 dark:divide-zinc-900 max-h-48 overflow-y-auto">
                  {files.map((f) => (
                    <div key={f.name} className="flex items-center px-3 py-2 gap-2 hover:bg-slate-50 dark:hover:bg-zinc-900/50 transition-colors">
                      <span className="text-[10px] font-mono bg-slate-100 dark:bg-zinc-900 px-1.5 py-0.5 rounded text-slate-600 dark:text-zinc-400 uppercase shrink-0 border border-slate-200 dark:border-zinc-800">
                        {f.name.split(".").pop()}
                      </span>
                      <span className="flex-1 text-xs text-slate-700 dark:text-zinc-300 truncate font-medium">{f.name}</span>
                      <span className="text-xs text-slate-400 dark:text-zinc-600 shrink-0">{(f.size / 1024).toFixed(1)} KB</span>
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

            {/* Right: goals */}
            <div className="space-y-3">
              <p className="text-xs font-bold text-slate-600 dark:text-zinc-400 uppercase tracking-wide">Your Business Goals</p>
              <p className="text-xs text-slate-400 dark:text-zinc-600">
                Describe the outcomes you want to automate, one per line. What should happen automatically across your systems?
              </p>
              <textarea
                value={useCaseText}
                onChange={(e) => setUseCaseText(e.target.value)}
                disabled={isRunning}
                placeholder={
                  "Sync new leads from our website to the CRM automatically\n" +
                  "Generate invoices when a deal is marked as closed\n" +
                  "Send order confirmation emails through our messaging platform\n" +
                  "Alert the team when a high-priority support ticket is created"
                }
                rows={9}
                className="w-full rounded-lg border border-slate-300 dark:border-zinc-800 px-3 py-2.5 text-sm text-slate-800 dark:text-zinc-100
                  placeholder:text-slate-400 dark:placeholder:text-zinc-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500
                  disabled:opacity-50 resize-none font-mono bg-white dark:bg-zinc-900 transition-colors duration-150"
              />
            </div>
          </div>

          {/* Footer actions */}
          <div className="px-5 py-4 border-t border-slate-100 dark:border-zinc-900 flex items-center gap-3 bg-slate-50/50 dark:bg-zinc-900/20">
            <button
              onClick={runAll}
              disabled={!files.length || !useCaseText.trim() || isRunning}
              className="px-5 py-2.5 bg-brand-600 text-white rounded-lg font-semibold hover:bg-brand-700 active:bg-brand-800
                disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2 text-sm shadow-sm"
            >
              {isRunning ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Analysing...
                </>
              ) : "Analyse Now"}
            </button>

            {hasStarted && !isRunning && (
              <button
                onClick={reset}
                className="px-4 py-2.5 border border-slate-300 dark:border-zinc-800 rounded-lg text-sm font-semibold text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-900 transition-colors bg-white dark:bg-zinc-950"
              >
                Start Over
              </button>
            )}

            {!files.length && (
              <p className="text-xs text-slate-400 dark:text-zinc-600">Add your documents to get started</p>
            )}
            {files.length > 0 && !useCaseText.trim() && (
              <p className="text-xs text-slate-400 dark:text-zinc-600">Add at least one business goal to continue</p>
            )}
          </div>
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* Pipeline progress                                                    */}
        {/* ------------------------------------------------------------------ */}
        {hasStarted && <PipelineProgress stages={pipelineStages} />}

        {/* ------------------------------------------------------------------ */}
        {/* Level 1 results                                                      */}
        {/* ------------------------------------------------------------------ */}
        {hasStarted && (
          <div className="space-y-4">
            {l1State.phase === "processing" && (
              <ProcessingFeed feed={l1Feed} defaultMsg="Scanning your documents..." />
            )}
            {l1State.phase === "error" && <ErrorCard message={l1State.message} />}

            {l1Result && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">Your Technology Map</h2>
                  <p className="text-xs text-slate-500 dark:text-zinc-500 mt-1">
                    Every software system and tool Bridgent found across your documents, along with how they connect. The confidence score shows how certain we are about each system.
                  </p>
                </div>
                {/* Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { label: "Documents Read",    value: l1Result.total_documents_processed },
                    { label: "Systems Found",     value: l1Result.total_systems_found },
                    { label: "Connections Mapped",value: l1Result.graph_stats.total_edges },
                    { label: "Needs Attention",   value: l1Result.systems_flagged_for_review },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-white dark:bg-zinc-950 rounded-xl border border-slate-200 dark:border-zinc-900 p-4 shadow-sm">
                      <p className="text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
                      <p className="text-xs text-slate-500 dark:text-zinc-500 mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>

                {/* Download */}
                <div className="flex justify-end">
                  <button
                    onClick={() => downloadJson(l1Result, "systems_report.json")}
                    className="flex items-center gap-2 px-4 py-2 border border-slate-300 dark:border-zinc-800 rounded-lg text-sm font-medium text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-900 transition-colors bg-white dark:bg-zinc-950"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download Systems Report
                  </button>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 bg-slate-100 dark:bg-zinc-900 rounded-lg p-1 w-fit border border-slate-200 dark:border-zinc-800">
                  {([
                    { key: "systems", label: "Systems" },
                    { key: "connections", label: "Network" },
                  ] as const).map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setActiveTab(key)}
                      className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors
                        ${activeTab === key
                          ? "bg-white dark:bg-zinc-950 text-slate-900 dark:text-white shadow-sm"
                          : "text-slate-500 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-300"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Systems table */}
                {activeTab === "systems" && (
                  <div className="bg-white dark:bg-zinc-950 rounded-xl border border-slate-200 dark:border-zinc-900 overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 dark:border-zinc-900 bg-slate-50 dark:bg-zinc-900/50 text-left">
                            <th className="px-4 py-3 font-semibold text-slate-600 dark:text-zinc-400">System Name</th>
                            <th className="px-4 py-3 font-semibold text-slate-600 dark:text-zinc-400">System Type</th>
                            <th className="px-4 py-3 font-semibold text-slate-600 dark:text-zinc-400">Importance</th>
                            <th className="px-4 py-3 font-semibold text-slate-600 dark:text-zinc-400 w-40">How Certain</th>
                            <th className="px-4 py-3 font-semibold text-slate-600 dark:text-zinc-400 text-center">Times Found</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-zinc-900">
                          {l1Result.systems.map((sys, i) => (
                            <tr key={`${sys.canonical_name}-${i}`}
                              className={sys.needs_human_review
                                ? "bg-amber-50/40 dark:bg-amber-950/10"
                                : "hover:bg-slate-50 dark:hover:bg-zinc-900/30 transition-colors"}>
                              <td className="px-4 py-3">
                                <div className="font-semibold text-slate-900 dark:text-white">{sys.canonical_name}</div>
                                {sys.needs_human_review && sys.review_note && (
                                  <div className="text-xs text-amber-700 dark:text-amber-400 mt-0.5 font-medium flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                                    {sys.review_note}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3 text-slate-600 dark:text-zinc-400">{sys.category}</td>
                              <td className="px-4 py-3">
                                <Badge text={sys.criticality} color={CRITICALITY_COLORS[sys.criticality] ?? CRITICALITY_COLORS.unknown} />
                              </td>
                              <td className="px-4 py-3"><ConfidenceBar value={sys.confidence} /></td>
                              <td className="px-4 py-3 text-slate-600 dark:text-zinc-400 text-center font-mono">{sys.mention_count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {l1Result.systems.length === 0 && (
                      <div className="px-4 py-8 text-center text-sm text-slate-400 dark:text-zinc-600">No systems found in your documents</div>
                    )}
                  </div>
                )}

                {/* Network graph */}
                {activeTab === "connections" && (
                  l1Result.relationships.length === 0
                    ? <div className="bg-white dark:bg-zinc-950 rounded-xl border border-slate-200 dark:border-zinc-900 px-4 py-8 text-center text-sm text-slate-400 dark:text-zinc-600 shadow-sm">No connections found between systems</div>
                    : <SystemGraph systems={l1Result.systems} relationships={l1Result.relationships} />
                )}
              </div>
            )}
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* Level 2 results                                                      */}
        {/* ------------------------------------------------------------------ */}
        {l2State.phase !== "idle" && (
          <div className="space-y-4">
            {l2State.phase === "processing" && (
              <ProcessingFeed feed={l2Feed} defaultMsg="Reviewing your business goals..." />
            )}
            {l2State.phase === "error" && <ErrorCard message={l2State.message} />}

            {l2Report && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">Integration Gaps</h2>
                  <p className="text-xs text-slate-500 dark:text-zinc-500 mt-1">
                    Connections between your systems that are missing or incomplete. Each gap blocks one or more of your business goals. The priority score helps you decide what to build first.
                  </p>
                </div>
                {/* Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { label: "Goals Reviewed",       value: l2Report.use_cases_analyzed },
                    { label: "Connections Assessed",  value: l2Report.total_gaps },
                    { label: "Connections Needed",    value: l2Report.missing_integrations },
                    { label: "Goals Not Matched",     value: l2Report.skipped.unmapped_use_cases.length },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-white dark:bg-zinc-950 rounded-xl border border-slate-200 dark:border-zinc-900 p-4 shadow-sm">
                      <p className="text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
                      <p className="text-xs text-slate-500 dark:text-zinc-500 mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>

                {/* Download */}
                <div className="flex justify-end">
                  <button
                    onClick={() => downloadJson(l2Report, "gap_report.json")}
                    className="flex items-center gap-2 px-4 py-2 border border-slate-300 dark:border-zinc-800 rounded-lg text-sm font-medium text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-900 transition-colors bg-white dark:bg-zinc-950"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download Gap Report
                  </button>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 bg-slate-100 dark:bg-zinc-900 rounded-lg p-1 w-fit border border-slate-200 dark:border-zinc-800">
                  {([
                    { key: "gaps",     label: `Missing Connections (${l2Report.gaps.length})` },
                    { key: "order",    label: `Build Order (${l2Report.dependency_graph.length})` },
                    { key: "unmatched",label: `Not Matched (${l2Report.skipped.unmapped_use_cases.length + l2Report.skipped.rejected_systems.length})` },
                  ] as const).map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setL2Tab(key)}
                      className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors
                        ${l2Tab === key
                          ? "bg-white dark:bg-zinc-950 text-slate-900 dark:text-white shadow-sm"
                          : "text-slate-500 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-300"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Missing connections table */}
                {l2Tab === "gaps" && (
                  <div className="bg-white dark:bg-zinc-950 rounded-xl border border-slate-200 dark:border-zinc-900 overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 dark:border-zinc-900 bg-slate-50 dark:bg-zinc-900/50 text-left">
                            <th className="px-4 py-3 font-semibold text-slate-600 dark:text-zinc-400">Connection</th>
                            <th className="px-4 py-3 font-semibold text-slate-600 dark:text-zinc-400">Status</th>
                            <th className="px-4 py-3 font-semibold text-slate-600 dark:text-zinc-400">Time Required</th>
                            <th className="px-4 py-3 font-semibold text-slate-600 dark:text-zinc-400 text-center">Goals Blocked</th>
                            <th className="px-4 py-3 font-semibold text-slate-600 dark:text-zinc-400 text-right">Priority</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-zinc-900">
                          {l2Report.gaps.map((gap, i) => (
                            <tr key={i}
                              className={gap.status === "missing"
                                ? "bg-red-50/20 dark:bg-red-950/10 hover:bg-red-50/30 dark:hover:bg-red-950/15"
                                : "hover:bg-slate-50 dark:hover:bg-zinc-900/30 transition-colors"}>
                              <td className="px-4 py-3">
                                <div className="font-semibold text-slate-900 dark:text-white">
                                  {gap.source_system} to {gap.destination_system}
                                </div>
                                {gap.entities.length > 0 && (
                                  <div className="text-xs text-slate-500 dark:text-zinc-500 mt-0.5 font-medium">
                                    {gap.entities.join(", ")}
                                  </div>
                                )}
                                {gap.effort_rationale && (
                                  <div className="text-xs text-slate-400 dark:text-zinc-600 mt-1 italic">{gap.effort_rationale}</div>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <Badge
                                  text={gap.status === "missing" ? "Missing" : "Available"}
                                  color={STATUS_COLORS[gap.status] ?? "bg-slate-100 text-slate-600"}
                                />
                              </td>
                              <td className="px-4 py-3">
                                {gap.effort ? (
                                  <div className="flex flex-col gap-0.5">
                                    <Badge text={gap.effort} color={EFFORT_COLORS[gap.effort] ?? "bg-slate-100 text-slate-600"} />
                                    <span className="text-[10px] text-slate-400 dark:text-zinc-600 font-medium">{EFFORT_LABELS[gap.effort]}</span>
                                  </div>
                                ) : (
                                  <span className="text-xs text-slate-400 dark:text-zinc-600">Not estimated</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-center text-slate-600 dark:text-zinc-400 font-mono font-semibold">
                                {gap.use_cases_blocked.length}
                              </td>
                              <td className="px-4 py-3 text-right font-mono text-sm text-slate-700 dark:text-zinc-300 font-bold">
                                {gap.priority_score.toFixed(0)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {l2Report.gaps.length === 0 && (
                      <div className="px-4 py-8 text-center text-sm text-slate-400 dark:text-zinc-600">
                        No missing connections found
                      </div>
                    )}
                  </div>
                )}

                {/* Build order */}
                {l2Tab === "order" && (
                  <div className="space-y-3">
                    {l2Report.dependency_graph.length === 0 ? (
                      <div className="bg-white dark:bg-zinc-950 rounded-xl border border-slate-200 dark:border-zinc-900 px-4 py-8 text-center text-sm text-slate-400 dark:text-zinc-600">
                        No dependencies between integrations
                      </div>
                    ) : (
                      l2Report.dependency_graph.map((dep, i) => (
                        <div key={i} className="bg-white dark:bg-zinc-950 rounded-xl border border-slate-200 dark:border-zinc-900 p-4 shadow-sm">
                          <div className="flex items-start gap-3">
                            <span className="mt-0.5 px-2 py-0.5 rounded bg-slate-100 dark:bg-zinc-900 text-slate-700 dark:text-zinc-300 text-xs font-bold font-mono whitespace-nowrap border border-slate-200 dark:border-zinc-800">
                              {dep.integration}
                            </span>
                            <div className="flex-1">
                              <p className="text-xs text-slate-500 dark:text-zinc-500 mb-1 font-semibold">must be built before:</p>
                              <ul className="space-y-1">
                                {dep.required_before.map((uc, j) => (
                                  <li key={j} className="text-sm text-slate-700 dark:text-zinc-300 flex items-start gap-1.5">
                                    <span className="text-slate-400 dark:text-zinc-600 mt-0.5">-</span>
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

                {/* Not matched */}
                {l2Tab === "unmatched" && (
                  <div className="space-y-4">
                    {l2Report.skipped.unmapped_use_cases.length > 0 && (
                      <div className="bg-white dark:bg-zinc-950 rounded-xl border border-slate-200 dark:border-zinc-900 overflow-hidden shadow-sm">
                        <div className="px-4 py-3 bg-slate-50 dark:bg-zinc-900/50 border-b border-slate-200 dark:border-zinc-900">
                          <p className="text-sm font-bold text-slate-700 dark:text-zinc-300">Goals We Could Not Match</p>
                        </div>
                        <div className="divide-y divide-slate-100 dark:divide-zinc-900">
                          {l2Report.skipped.unmapped_use_cases.map((item, i) => (
                            <div key={i} className="px-4 py-3">
                              <p className="text-sm text-slate-800 dark:text-zinc-200 font-medium">{item.text}</p>
                              <p className="text-xs text-slate-500 dark:text-zinc-500 mt-0.5">{item.reason}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {l2Report.skipped.rejected_systems.length > 0 && (
                      <div className="bg-white dark:bg-zinc-950 rounded-xl border border-slate-200 dark:border-zinc-900 overflow-hidden shadow-sm">
                        <div className="px-4 py-3 bg-slate-50 dark:bg-zinc-900/50 border-b border-slate-200 dark:border-zinc-900">
                          <p className="text-sm font-bold text-slate-700 dark:text-zinc-300">Unrecognised Systems</p>
                          <p className="text-xs text-slate-400 dark:text-zinc-600 mt-0.5">These systems were mentioned in your goals but were not found in your documents.</p>
                        </div>
                        <div className="divide-y divide-slate-100 dark:divide-zinc-900">
                          {l2Report.skipped.rejected_systems.map((item, i) => (
                            <div key={i} className="px-4 py-3">
                              <p className="text-sm text-slate-800 dark:text-zinc-200 font-bold">{item.system}</p>
                              <p className="text-xs text-slate-500 dark:text-zinc-500">{item.use_case}</p>
                              <p className="text-xs text-slate-400 dark:text-zinc-600 mt-0.5 italic">{item.reason}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {l2Report.skipped.missing_capabilities.length > 0 && (
                      <div className="bg-white dark:bg-zinc-950 rounded-xl border border-slate-200 dark:border-zinc-900 overflow-hidden shadow-sm">
                        <div className="px-4 py-3 bg-slate-50 dark:bg-zinc-900/50 border-b border-slate-200 dark:border-zinc-900">
                          <p className="text-sm font-bold text-slate-700 dark:text-zinc-300">Missing Functionality</p>
                        </div>
                        <div className="divide-y divide-slate-100 dark:divide-zinc-900">
                          {l2Report.skipped.missing_capabilities.map((item, i) => (
                            <div key={i} className="px-4 py-3">
                              <p className="text-sm text-slate-800 dark:text-zinc-200 font-medium">{item.capability_needed}</p>
                              <p className="text-xs text-slate-500 dark:text-zinc-500">{item.use_case}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {l2Report.skipped.unmapped_use_cases.length === 0 &&
                      l2Report.skipped.rejected_systems.length === 0 &&
                      l2Report.skipped.missing_capabilities.length === 0 && (
                      <div className="bg-white dark:bg-zinc-950 rounded-xl border border-slate-200 dark:border-zinc-900 px-4 py-8 text-center text-sm text-slate-400 dark:text-zinc-600">
                        All goals were successfully matched
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* Level 3 results                                                      */}
        {/* ------------------------------------------------------------------ */}
        {l3State.phase !== "idle" && (
          <div className="space-y-4">
            {l3State.phase === "processing" && (
              <ProcessingFeed feed={l3Feed} defaultMsg="Building your integrations..." />
            )}
            {l3State.phase === "error" && <ErrorCard message={l3State.message} />}

            {l3Bundles && l3Bundles.length > 0 && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">Ready-to-Deploy Integrations</h2>
                  <p className="text-xs text-slate-500 dark:text-zinc-500 mt-1">
                    Fully written integration code for each gap Bridgent found. Download a package and deploy it to connect your systems. Each package includes the connector, configuration, tests, and setup guide.
                  </p>
                </div>
                {/* Stats + download all */}
                <div className="flex flex-wrap items-start gap-4">
                  <div className="grid grid-cols-4 gap-4 flex-1">
                    {[
                      { label: "Integrations Built", value: l3Bundles.length,                                                                       color: "text-slate-900 dark:text-white" },
                      { label: "Ready to Deploy",    value: l3Bundles.filter(b => !b.manual_setup_required && b.validation.valid).length,            color: "text-green-700 dark:text-green-400" },
                      { label: "Need Review",        value: l3Bundles.filter(b => !b.manual_setup_required && !b.validation.valid).length,           color: "text-red-700 dark:text-red-400" },
                      { label: "Manual Setup",       value: l3Bundles.filter(b => b.manual_setup_required).length,                                   color: "text-amber-700 dark:text-amber-400" },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="bg-white dark:bg-zinc-950 rounded-xl border border-slate-200 dark:border-zinc-900 p-4 shadow-sm">
                        <p className={`text-2xl font-bold ${color}`}>{value}</p>
                        <p className="text-xs text-slate-500 dark:text-zinc-500 mt-0.5">{label}</p>
                      </div>
                    ))}
                  </div>
                  {l3Bundles.some(b => !b.manual_setup_required) && (
                    <button
                      onClick={() => downloadAllBundles(l3Bundles.filter(b => !b.manual_setup_required))}
                      className="flex items-center gap-2 px-4 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-semibold hover:bg-brand-700 active:bg-brand-800 transition-colors shadow-sm whitespace-nowrap"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Download All Integrations
                    </button>
                  )}
                </div>

                {/* Bundle cards */}
                {l3Bundles.map((bundle, i) => (
                  <div key={i} className="bg-white dark:bg-zinc-950 rounded-xl border border-slate-200 dark:border-zinc-900 overflow-hidden shadow-sm">

                    {/* Card header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-zinc-900 bg-slate-50/30 dark:bg-zinc-900/30">
                      <div>
                        <div className="font-bold text-slate-900 dark:text-white">
                          {bundle.source_system} to {bundle.destination_system}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {bundle.manual_setup_required
                          ? <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/40 uppercase tracking-wide">Manual Setup Required</span>
                          : bundle.validation.valid
                            ? <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-green-100 dark:bg-green-950/40 text-green-800 dark:text-green-300 border border-green-200/50 dark:border-green-800/40 uppercase tracking-wide">Ready to Deploy</span>
                            : <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-300 border border-red-200/50 dark:border-red-800/40 uppercase tracking-wide">Needs Review</span>
                        }
                        {!bundle.manual_setup_required && (
                          <button
                            onClick={() => downloadBundle(bundle)}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border border-slate-300 dark:border-zinc-800 text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-900 transition-colors bg-white dark:bg-zinc-950"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Download
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Manual setup explanation */}
                    {bundle.manual_setup_required && bundle.paradigm_notes && (
                      <div className="px-4 py-3 bg-amber-50/50 dark:bg-amber-950/10 border-b border-slate-100 dark:border-zinc-900">
                        <p className="text-xs font-bold text-amber-800 dark:text-amber-400 mb-1">Why this requires manual setup:</p>
                        <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed whitespace-pre-wrap">
                          {bundle.paradigm_notes}
                        </p>
                      </div>
                    )}

                    {/* Validation status */}
                    {!bundle.manual_setup_required && (
                      <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 border-b border-slate-100 dark:border-zinc-900 bg-slate-50/20 dark:bg-zinc-900/10">
                        {[
                          { label: "Code Valid",      ok: bundle.validation.connector_compiles },
                          { label: "Dependencies OK", ok: bundle.validation.connector_imports },
                          { label: "Config Valid",    ok: bundle.validation.agent_def_valid },
                          { label: "Tests Pass",      ok: bundle.validation.tests_pass },
                        ].map(({ label, ok }) => (
                          <div key={label} className="flex items-center gap-1.5 text-xs font-medium">
                            <span className={ok ? "text-green-600 dark:text-green-400 font-bold" : "text-red-500 dark:text-red-400 font-bold"}>
                              {ok ? "✓" : "✗"}
                            </span>
                            <span className={ok ? "text-slate-700 dark:text-zinc-300" : "text-slate-400 dark:text-zinc-600"}>{label}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Failure details */}
                    {!bundle.manual_setup_required && bundle.validation.failures.length > 0 && (
                      <div className="px-4 py-3 bg-red-50/50 dark:bg-red-950/10 border-b border-slate-100 dark:border-zinc-900">
                        <p className="text-xs font-bold text-red-700 dark:text-red-400 mb-1.5">Issues Found:</p>
                        <ul className="space-y-1">
                          {bundle.validation.failures.map((f, j) => (
                            <li key={j} className="text-xs text-red-600 dark:text-red-400 font-mono whitespace-pre-wrap break-all">{f}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Integration files viewer */}
                    {!bundle.manual_setup_required && (
                      <>
                        <button
                          onClick={() => {
                            setExpandedBundle(expandedBundle === i ? null : i)
                            setBundleFileTab("connector")
                          }}
                          className="w-full px-4 py-2.5 text-left flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-zinc-500 hover:bg-slate-50 dark:hover:bg-zinc-900/50 transition-colors border-t border-slate-100 dark:border-zinc-900"
                        >
                          <span>View Integration Files</span>
                          <svg
                            className={`w-4 h-4 transition-transform duration-200 ${expandedBundle === i ? "rotate-180" : ""}`}
                            fill="none" stroke="currentColor" viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>

                        {expandedBundle === i && (
                          <div className="border-t border-slate-100 dark:border-zinc-900">
                            <div className="flex flex-wrap gap-0.5 bg-slate-100 dark:bg-zinc-900 p-1 border-b border-slate-200 dark:border-zinc-900">
                              {([
                                { key: "connector",    label: "Integration Code" },
                                { key: "agent_def",    label: "Configuration" },
                                { key: "tests",        label: "Tests" },
                                { key: "requirements", label: "Dependencies" },
                                { key: "readme",       label: "Instructions" },
                              ] as const).map(({ key, label }) => (
                                <button
                                  key={key}
                                  onClick={() => setBundleFileTab(key)}
                                  className={`px-3 py-1 rounded text-xs font-semibold transition-colors
                                    ${bundleFileTab === key
                                      ? "bg-white dark:bg-zinc-950 text-slate-900 dark:text-white shadow-sm"
                                      : "text-slate-500 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-300"}`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                            <pre className="p-4 text-xs font-mono text-slate-700 dark:text-zinc-300 whitespace-pre-wrap break-all bg-slate-50 dark:bg-black max-h-80 overflow-y-auto">
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
