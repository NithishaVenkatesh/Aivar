"use client"

import { useState } from "react"
import type { GapReport } from "../types"
import { Badge, CRITICALITY_COLORS, EFFORT_COLORS, EFFORT_LABELS, STATUS_COLORS } from "./shared"
import { downloadJson } from "../../lib/download"

interface L2ResultCardProps {
  report: GapReport
}

export function L2ResultCard({ report }: L2ResultCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState<"gaps" | "order" | "unmatched">("gaps")

  const unmatchedCount = report.skipped.unmapped_use_cases.length + report.skipped.rejected_systems.length

  return (
    <div className="bg-white dark:bg-zinc-950 rounded-2xl rounded-tl-sm border border-slate-200 dark:border-zinc-900 shadow-sm overflow-hidden">
      {/* Summary */}
      <div className="px-5 py-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-blue-500 font-bold">⚡</span>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">Integration gap analysis complete</p>
        </div>
        <div className="grid grid-cols-4 gap-3 mb-4">
          {[
            { label: "Goals reviewed",   value: report.use_cases_analyzed },
            { label: "Connections seen", value: report.total_gaps },
            { label: "Missing",          value: report.missing_integrations },
            { label: "Not matched",      value: unmatchedCount },
          ].map(({ label, value }) => (
            <div key={label} className="text-center bg-slate-50 dark:bg-zinc-900/50 rounded-xl py-3 border border-slate-100 dark:border-zinc-800">
              <p className={`text-xl font-bold ${label === "Missing" && value > 0 ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-white"}`}>{value}</p>
              <p className="text-[11px] text-slate-500 dark:text-zinc-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-900 transition-colors"
          >
            {expanded ? "Hide details" : "View gap analysis"}
            <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <button
            onClick={() => downloadJson(report, "gap_report.json")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-900 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download report
          </button>
        </div>
      </div>

      {/* Expandable detail */}
      {expanded && (
        <div className="border-t border-slate-100 dark:border-zinc-900">
          <div className="px-4 py-2.5 bg-slate-50/50 dark:bg-zinc-900/30 border-b border-slate-100 dark:border-zinc-900 flex flex-wrap gap-1">
            {([
              { key: "gaps" as const,     label: `Missing (${report.gaps.length})` },
              { key: "order" as const,    label: `Build order (${report.dependency_graph.length})` },
              { key: "unmatched" as const, label: `Not matched (${unmatchedCount})` },
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

          {activeTab === "gaps" && (
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0">
                  <tr className="border-b border-slate-200 dark:border-zinc-900 bg-slate-50 dark:bg-zinc-900/80 text-left">
                    <th className="px-4 py-3 font-semibold text-slate-600 dark:text-zinc-400">Connection</th>
                    <th className="px-4 py-3 font-semibold text-slate-600 dark:text-zinc-400">Status</th>
                    <th className="px-4 py-3 font-semibold text-slate-600 dark:text-zinc-400">Effort</th>
                    <th className="px-4 py-3 font-semibold text-slate-600 dark:text-zinc-400 text-center">Goals blocked</th>
                    <th className="px-4 py-3 font-semibold text-slate-600 dark:text-zinc-400 text-right">Priority</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-zinc-900">
                  {report.gaps.map((gap, i) => (
                    <tr key={i}
                      className={gap.status === "missing"
                        ? "bg-red-50/20 dark:bg-red-950/10 hover:bg-red-50/30 dark:hover:bg-red-950/15"
                        : "hover:bg-slate-50 dark:hover:bg-zinc-900/30 transition-colors"}>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {gap.source_system} → {gap.destination_system}
                        </div>
                        {gap.entities.length > 0 && (
                          <div className="text-xs text-slate-500 dark:text-zinc-500 mt-0.5">{gap.entities.join(", ")}</div>
                        )}
                        {gap.effort_rationale && (
                          <div className="text-xs text-slate-400 dark:text-zinc-600 mt-0.5 italic">{gap.effort_rationale}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          text={gap.status === "missing" ? "Missing" : "Available"}
                          color={STATUS_COLORS[gap.status] ?? CRITICALITY_COLORS.unknown}
                        />
                      </td>
                      <td className="px-4 py-3">
                        {gap.effort ? (
                          <div className="flex flex-col gap-0.5">
                            <Badge text={gap.effort} color={EFFORT_COLORS[gap.effort] ?? CRITICALITY_COLORS.unknown} />
                            <span className="text-[10px] text-slate-400 dark:text-zinc-600">{EFFORT_LABELS[gap.effort]}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400 dark:text-zinc-600">—</span>
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
              {report.gaps.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-slate-400 dark:text-zinc-600">No missing connections found</p>
              )}
            </div>
          )}

          {activeTab === "order" && (
            <div className="p-4 space-y-3 max-h-80 overflow-y-auto">
              {report.dependency_graph.length === 0 ? (
                <p className="text-center text-sm text-slate-400 dark:text-zinc-600 py-4">No build dependencies</p>
              ) : (
                report.dependency_graph.map((dep, i) => (
                  <div key={i} className="bg-slate-50 dark:bg-zinc-900/50 rounded-xl p-4 border border-slate-100 dark:border-zinc-800">
                    <div className="flex items-start gap-3">
                      <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 text-xs font-bold font-mono border border-slate-300 dark:border-zinc-700 whitespace-nowrap shrink-0">
                        {dep.integration}
                      </span>
                      <div>
                        <p className="text-xs text-slate-500 dark:text-zinc-500 mb-1 font-semibold">must be built before:</p>
                        <ul className="space-y-1">
                          {dep.required_before.map((uc, j) => (
                            <li key={j} className="text-sm text-slate-700 dark:text-zinc-300 flex items-start gap-1.5">
                              <span className="text-slate-400 dark:text-zinc-600 mt-0.5 shrink-0">–</span>
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

          {activeTab === "unmatched" && (
            <div className="p-4 space-y-4 max-h-80 overflow-y-auto">
              {report.skipped.unmapped_use_cases.length > 0 && (
                <div className="rounded-xl border border-slate-200 dark:border-zinc-800 overflow-hidden">
                  <div className="px-4 py-2.5 bg-slate-50 dark:bg-zinc-900/50 border-b border-slate-200 dark:border-zinc-800">
                    <p className="text-xs font-bold text-slate-700 dark:text-zinc-300">Goals we could not match</p>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-zinc-900">
                    {report.skipped.unmapped_use_cases.map((item, i) => (
                      <div key={i} className="px-4 py-3">
                        <p className="text-sm text-slate-800 dark:text-zinc-200 font-medium">{item.text}</p>
                        <p className="text-xs text-slate-500 dark:text-zinc-500 mt-0.5">{item.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {report.skipped.rejected_systems.length > 0 && (
                <div className="rounded-xl border border-slate-200 dark:border-zinc-800 overflow-hidden">
                  <div className="px-4 py-2.5 bg-slate-50 dark:bg-zinc-900/50 border-b border-slate-200 dark:border-zinc-800">
                    <p className="text-xs font-bold text-slate-700 dark:text-zinc-300">Unrecognised systems</p>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-zinc-900">
                    {report.skipped.rejected_systems.map((item, i) => (
                      <div key={i} className="px-4 py-3">
                        <p className="text-sm text-slate-800 dark:text-zinc-200 font-bold">{item.system}</p>
                        <p className="text-xs text-slate-500 dark:text-zinc-500">{item.use_case}</p>
                        <p className="text-xs text-slate-400 dark:text-zinc-600 mt-0.5 italic">{item.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {report.skipped.unmapped_use_cases.length === 0 && report.skipped.rejected_systems.length === 0 && (
                <p className="text-center text-sm text-slate-400 dark:text-zinc-600 py-4">All goals were successfully matched</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
