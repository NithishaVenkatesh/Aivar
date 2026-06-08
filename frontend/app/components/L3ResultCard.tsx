"use client"

import { useState } from "react"
import type { GeneratedBundle } from "../types"
import { downloadBundle, downloadAllBundles } from "../../lib/download"

interface L3ResultCardProps {
  bundles: GeneratedBundle[]
}

type FileTab = "connector" | "agent_def" | "tests" | "requirements" | "readme"

function BundleCard({ bundle }: { bundle: GeneratedBundle }) {
  const [expanded, setExpanded] = useState(false)
  const [fileTab, setFileTab] = useState<FileTab>("connector")

  const content =
    fileTab === "connector"    ? bundle.connector_code
    : fileTab === "agent_def"  ? bundle.agent_def_yaml
    : fileTab === "tests"      ? bundle.test_code
    : fileTab === "requirements" ? bundle.requirements
    : bundle.readme

  return (
    <div className="rounded-xl border border-slate-200 dark:border-zinc-800 overflow-hidden">
      {/* Bundle header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-50/50 dark:bg-zinc-900/30">
        <span className="text-sm font-semibold text-slate-900 dark:text-white">
          {bundle.source_system} → {bundle.destination_system}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {bundle.manual_setup_required
            ? <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/40 uppercase tracking-wide">Manual setup</span>
            : bundle.validation.valid
              ? <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 dark:bg-green-950/40 text-green-800 dark:text-green-300 border border-green-200/50 dark:border-green-800/40 uppercase tracking-wide">Ready</span>
              : <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-300 border border-red-200/50 dark:border-red-800/40 uppercase tracking-wide">Needs review</span>
          }
          {!bundle.manual_setup_required && (
            <button
              onClick={() => downloadBundle(bundle)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-900 transition-colors bg-white dark:bg-zinc-950"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download
            </button>
          )}
        </div>
      </div>

      {/* Manual setup note */}
      {bundle.manual_setup_required && bundle.paradigm_notes && (
        <div className="px-4 py-3 bg-amber-50/50 dark:bg-amber-950/10 border-t border-slate-100 dark:border-zinc-900">
          <p className="text-xs font-bold text-amber-800 dark:text-amber-400 mb-1">Why manual setup is required:</p>
          <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed whitespace-pre-wrap">{bundle.paradigm_notes}</p>
        </div>
      )}

      {/* Validation checks */}
      {!bundle.manual_setup_required && (
        <div className="px-4 py-2.5 grid grid-cols-4 gap-2 border-t border-slate-100 dark:border-zinc-900 bg-slate-50/20 dark:bg-zinc-900/10">
          {[
            { label: "Code valid",      ok: bundle.validation.connector_compiles },
            { label: "Imports OK",      ok: bundle.validation.connector_imports },
            { label: "Config valid",    ok: bundle.validation.agent_def_valid },
            { label: "Tests pass",      ok: bundle.validation.tests_pass },
          ].map(({ label, ok }) => (
            <div key={label} className="flex items-center gap-1.5 text-xs font-medium">
              <span className={ok ? "text-green-600 dark:text-green-400 font-bold" : "text-red-500 dark:text-red-400 font-bold"}>
                {ok ? "✓" : "✗"}
              </span>
              <span className={ok ? "text-slate-700 dark:text-zinc-300" : "text-slate-400 dark:text-zinc-500"}>{label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Failure list */}
      {!bundle.manual_setup_required && bundle.validation.failures.length > 0 && (
        <div className="px-4 py-3 bg-red-50/50 dark:bg-red-950/10 border-t border-slate-100 dark:border-zinc-900">
          <p className="text-xs font-bold text-red-700 dark:text-red-400 mb-1">Issues:</p>
          <ul className="space-y-1">
            {bundle.validation.failures.map((f, j) => (
              <li key={j} className="text-xs text-red-600 dark:text-red-400 font-mono whitespace-pre-wrap break-all">{f}</li>
            ))}
          </ul>
        </div>
      )}

      {/* View files toggle */}
      {!bundle.manual_setup_required && (
        <>
          <button
            onClick={() => { setExpanded(e => !e); setFileTab("connector") }}
            className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-zinc-500 hover:bg-slate-50 dark:hover:bg-zinc-900/50 transition-colors border-t border-slate-100 dark:border-zinc-900"
          >
            <span>View integration files</span>
            <svg className={`w-4 h-4 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {expanded && (
            <div className="border-t border-slate-100 dark:border-zinc-900">
              <div className="flex flex-wrap gap-0.5 bg-slate-100 dark:bg-zinc-900 p-1 border-b border-slate-200 dark:border-zinc-900">
                {([
                  { key: "connector" as FileTab,    label: "Connector" },
                  { key: "agent_def" as FileTab,    label: "Config" },
                  { key: "tests" as FileTab,        label: "Tests" },
                  { key: "requirements" as FileTab, label: "Dependencies" },
                  { key: "readme" as FileTab,       label: "Instructions" },
                ]).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setFileTab(key)}
                    className={`px-3 py-1 rounded text-xs font-semibold transition-colors
                      ${fileTab === key
                        ? "bg-white dark:bg-zinc-950 text-slate-900 dark:text-white shadow-sm"
                        : "text-slate-500 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-300"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <pre className="p-4 text-xs font-mono text-slate-700 dark:text-zinc-300 whitespace-pre-wrap break-all bg-slate-50 dark:bg-black max-h-80 overflow-y-auto">
                {content}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function L3ResultCard({ bundles }: L3ResultCardProps) {
  const [expanded, setExpanded] = useState(false)

  const readyCount = bundles.filter(b => !b.manual_setup_required && b.validation.valid).length
  const manualCount = bundles.filter(b => b.manual_setup_required).length
  const downloadableBundles = bundles.filter(b => !b.manual_setup_required)

  return (
    <div className="bg-white dark:bg-zinc-950 rounded-2xl rounded-tl-sm border border-slate-200 dark:border-zinc-900 shadow-sm overflow-hidden">
      {/* Summary */}
      <div className="px-5 py-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-brand-500 font-bold">✦</span>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">
            {bundles.length === 1
              ? "Built 1 integration"
              : `Built ${bundles.length} integrations`}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3 mb-4">
          {[
            { label: "Total built",   value: bundles.length, color: "text-slate-900 dark:text-white" },
            { label: "Ready to deploy", value: readyCount, color: "text-green-700 dark:text-green-400" },
            { label: "Manual setup",  value: manualCount, color: "text-amber-700 dark:text-amber-400" },
          ].map(({ label, value, color }) => (
            <div key={label} className="text-center bg-slate-50 dark:bg-zinc-900/50 rounded-xl py-3 border border-slate-100 dark:border-zinc-800">
              <p className={`text-xl font-bold ${color}`}>{value}</p>
              <p className="text-[11px] text-slate-500 dark:text-zinc-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-900 transition-colors"
          >
            {expanded ? "Hide integrations" : "View integrations"}
            <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {downloadableBundles.length > 0 && (
            <button
              onClick={() => downloadAllBundles(downloadableBundles)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-brand-600 hover:bg-brand-700 text-white transition-colors shadow-sm"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download all ({downloadableBundles.length})
            </button>
          )}
        </div>
      </div>

      {/* Expandable bundles */}
      {expanded && (
        <div className="border-t border-slate-100 dark:border-zinc-900 p-4 space-y-3">
          {bundles.map((bundle, i) => (
            <BundleCard key={i} bundle={bundle} />
          ))}
        </div>
      )}
    </div>
  )
}
