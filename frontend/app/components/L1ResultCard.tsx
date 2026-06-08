"use client"

import { useState } from "react"
import type { DiscoveryResult } from "../types"
import { Badge, ConfidenceBar, SystemGraph, CRITICALITY_COLORS } from "./shared"
import { downloadJson } from "../../lib/download"

interface L1ResultCardProps {
  result: DiscoveryResult
}

export function L1ResultCard({ result }: L1ResultCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState<"systems" | "connections">("systems")

  return (
    <div className="bg-white dark:bg-zinc-950 rounded-2xl rounded-tl-sm border border-slate-200 dark:border-zinc-900 shadow-sm overflow-hidden">
      {/* Summary — always visible */}
      <div className="px-5 py-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-green-500 font-bold">✓</span>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">Mapped your technology stack</p>
        </div>
        <div className="grid grid-cols-4 gap-3 mb-4">
          {[
            { label: "Documents", value: result.total_documents_processed },
            { label: "Systems",   value: result.total_systems_found },
            { label: "Connections", value: result.graph_stats.total_edges },
            { label: "Needs review", value: result.systems_flagged_for_review },
          ].map(({ label, value }) => (
            <div key={label} className="text-center bg-slate-50 dark:bg-zinc-900/50 rounded-xl py-3 border border-slate-100 dark:border-zinc-800">
              <p className="text-xl font-bold text-slate-900 dark:text-white">{value}</p>
              <p className="text-[11px] text-slate-500 dark:text-zinc-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-900 transition-colors"
          >
            {expanded ? "Hide details" : "View system map"}
            <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <button
            onClick={() => downloadJson(result, "systems_report.json")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-900 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download JSON
          </button>
        </div>
      </div>

      {/* Expandable detail */}
      {expanded && (
        <div className="border-t border-slate-100 dark:border-zinc-900">
          <div className="px-4 py-2.5 bg-slate-50/50 dark:bg-zinc-900/30 border-b border-slate-100 dark:border-zinc-900 flex gap-1">
            {([
              { key: "systems" as const, label: "Systems" },
              { key: "connections" as const, label: "Network" },
            ]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`px-3 py-1 rounded text-xs font-semibold transition-colors
                  ${activeTab === key
                    ? "bg-white dark:bg-zinc-950 text-slate-900 dark:text-white shadow-sm border border-slate-200 dark:border-zinc-800"
                    : "text-slate-500 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-300"}`}
              >
                {label}
              </button>
            ))}
          </div>

          {activeTab === "systems" && (
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0">
                  <tr className="border-b border-slate-200 dark:border-zinc-900 bg-slate-50 dark:bg-zinc-900/80 text-left">
                    <th className="px-4 py-3 font-semibold text-slate-600 dark:text-zinc-400">System</th>
                    <th className="px-4 py-3 font-semibold text-slate-600 dark:text-zinc-400">Type</th>
                    <th className="px-4 py-3 font-semibold text-slate-600 dark:text-zinc-400">Importance</th>
                    <th className="px-4 py-3 font-semibold text-slate-600 dark:text-zinc-400 w-36">Confidence</th>
                    <th className="px-4 py-3 font-semibold text-slate-600 dark:text-zinc-400 text-center">Mentions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-zinc-900">
                  {result.systems.map((sys, i) => (
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
                      <td className="px-4 py-3 text-center text-slate-600 dark:text-zinc-400 font-mono">{sys.mention_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.systems.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-slate-400 dark:text-zinc-600">No systems found in your documents</p>
              )}
            </div>
          )}

          {activeTab === "connections" && (
            result.relationships.length === 0
              ? <p className="px-4 py-8 text-center text-sm text-slate-400 dark:text-zinc-600">No connections found between systems</p>
              : <SystemGraph systems={result.systems} relationships={result.relationships} />
          )}
        </div>
      )}
    </div>
  )
}
