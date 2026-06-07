"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { useDropzone } from "react-dropzone"

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

type State =
  | { phase: "idle" }
  | { phase: "processing"; logs: string[] }
  | { phase: "done"; result: DiscoveryResult; logs: string[] }
  | { phase: "error"; message: string; logs: string[] }

const CRITICALITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-800",
  high: "bg-orange-100 text-orange-800",
  medium: "bg-yellow-100 text-yellow-800",
  low: "bg-green-100 text-green-800",
  unknown: "bg-slate-100 text-slate-600",
}

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

function LogPanel({ logs, active }: { logs: string[]; active: boolean }) {
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
            Pipeline logs — {logs.length} line{logs.length !== 1 ? "s" : ""}
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

export default function HomePage() {
  const [files, setFiles] = useState<File[]>([])
  const [state, setState] = useState<State>({ phase: "idle" })
  const [activeTab, setActiveTab] = useState<"systems" | "relationships">("systems")

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

  const run = async () => {
    if (!files.length) return
    setState({ phase: "processing", logs: [] })

    const form = new FormData()
    files.forEach((f) => form.append("files", f))

    try {
      const res = await fetch("/api/discover", { method: "POST", body: form })

      if (!res.ok || !res.body) {
        const data = await res.json()
        setState({ phase: "error", message: data.error ?? "Request failed", logs: [] })
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
          try {
            event = JSON.parse(line.slice(6))
          } catch {
            continue
          }

          if (event.type === "log" && event.message) {
            setState((prev) =>
              prev.phase === "processing"
                ? { ...prev, logs: [...prev.logs, event.message!] }
                : prev
            )
          } else if (event.type === "result" && event.data) {
            setState((prev) => ({
              phase: "done",
              result: event.data!,
              logs: prev.phase === "processing" ? prev.logs : [],
            }))
          } else if (event.type === "error" && event.message) {
            setState((prev) => ({
              phase: "error",
              message: event.message!,
              logs: prev.phase === "processing" ? prev.logs : [],
            }))
          }
        }
      }
    } catch (err: unknown) {
      setState((prev) => ({
        phase: "error",
        message: err instanceof Error ? err.message : "Unknown error",
        logs: prev.phase === "processing" ? prev.logs : [],
      }))
    }
  }

  const logs =
    state.phase === "processing" || state.phase === "done" || state.phase === "error"
      ? state.logs
      : []

  const result = state.phase === "done" ? state.result : null

  return (
    <main className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
          <span className="text-white text-sm font-bold">A</span>
        </div>
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Aivar Discovery Agent</h1>
          <p className="text-xs text-slate-500">Enterprise system discovery from documents</p>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
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
                <span className="text-xs text-slate-400">
                  {(f.size / 1024).toFixed(1)} KB
                </span>
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
            onClick={run}
            disabled={!files.length || state.phase === "processing"}
            className="px-5 py-2.5 bg-brand-600 text-white rounded-lg font-medium hover:bg-brand-700
              disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {state.phase === "processing" ? "Analyzing…" : "Discover Systems"}
          </button>
          {(state.phase === "done" || state.phase === "error") && (
            <button
              onClick={() => { setState({ phase: "idle" }); setFiles([]) }}
              className="px-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition-colors"
            >
              Reset
            </button>
          )}
        </div>

        {/* Log panel */}
        <LogPanel logs={logs} active={state.phase === "processing"} />

        {/* Error */}
        {state.phase === "error" && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            <strong>Error:</strong> {state.message}
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-6">
            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: "Documents", value: result.total_documents_processed },
                { label: "Systems Found", value: result.total_systems_found },
                { label: "Relationships", value: result.graph_stats.total_edges },
                { label: "Flagged for Review", value: result.systems_flagged_for_review },
              ].map(({ label, value }) => (
                <div key={label} className="bg-white rounded-xl border border-slate-200 p-4">
                  <p className="text-2xl font-bold text-slate-900">{value}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{label}</p>
                </div>
              ))}
            </div>

            {/* Download */}
            <div className="flex justify-end">
              <button
                onClick={() => {
                  const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" })
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
                Download JSON
              </button>
            </div>

            {/* Tab switcher */}
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
                    {result.systems.map((sys, i) => (
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
                        <td className="px-4 py-3">
                          <ConfidenceBar value={sys.confidence} />
                        </td>
                        <td className="px-4 py-3 text-slate-600 text-center">{sys.mention_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.systems.length === 0 && (
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
                    {result.relationships.map((rel, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-900">{rel.source}</td>
                        <td className="px-4 py-3">
                          <span className="text-xs bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full font-mono">
                            {rel.relation}
                          </span>
                          <span className="ml-2 text-xs text-slate-400">{rel.direction}</span>
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">{rel.target}</td>
                        <td className="px-4 py-3">
                          <ConfidenceBar value={rel.confidence} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.relationships.length === 0 && (
                  <div className="px-4 py-8 text-center text-sm text-slate-400">No relationships found</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
