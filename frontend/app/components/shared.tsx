"use client"

import { useRef, useState, useEffect, useMemo } from "react"
import type { SystemNode, SystemRelationship } from "../types"

export const CRITICALITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-300 border border-red-200/50 dark:border-red-800/40",
  high: "bg-orange-100 dark:bg-orange-950/40 text-orange-800 dark:text-orange-300 border border-orange-200/50 dark:border-orange-800/40",
  medium: "bg-yellow-100 dark:bg-yellow-950/40 text-yellow-800 dark:text-yellow-300 border border-yellow-200/50 dark:border-yellow-800/40",
  low: "bg-green-100 dark:bg-green-950/40 text-green-800 dark:text-green-300 border border-green-200/50 dark:border-green-800/40",
  unknown: "bg-slate-100 dark:bg-zinc-900 text-slate-600 dark:text-zinc-400 border border-slate-200/50 dark:border-zinc-800",
}

export const EFFORT_COLORS: Record<string, string> = {
  S: "bg-green-100 dark:bg-green-950/40 text-green-800 dark:text-green-300 border border-green-200/50 dark:border-green-800/40",
  M: "bg-yellow-100 dark:bg-yellow-950/40 text-yellow-800 dark:text-yellow-300 border border-yellow-200/50 dark:border-yellow-800/40",
  L: "bg-orange-100 dark:bg-orange-950/40 text-orange-800 dark:text-orange-300 border border-orange-200/50 dark:border-orange-800/40",
  XL: "bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-300 border border-red-200/50 dark:border-red-800/40",
}

export const EFFORT_LABELS: Record<string, string> = {
  S: "1 to 3 days",
  M: "1 to 2 weeks",
  L: "3 to 6 weeks",
  XL: "2 or more months",
}

export const STATUS_COLORS: Record<string, string> = {
  available: "bg-green-100 dark:bg-green-950/40 text-green-800 dark:text-green-300 border border-green-200/50 dark:border-green-800/40",
  missing: "bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-300 border border-red-200/50 dark:border-red-800/40",
}

export function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider ${color}`}>
      {text}
    </span>
  )
}

export function ConfidenceBar({ value }: { value: number }) {
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

export function ErrorCard({ message }: { message: string }) {
  return (
    <div className="bg-white dark:bg-zinc-950 rounded-2xl rounded-tl-sm border border-red-200 dark:border-red-900/50 px-4 py-4 shadow-sm">
      <div className="flex items-start gap-3">
        <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div>
          <p className="text-sm font-semibold text-red-700 dark:text-red-300">We ran into a problem</p>
          <p className="text-sm text-red-600 dark:text-red-400 mt-0.5">{message}</p>
          <p className="text-xs text-red-400 dark:text-red-600 mt-1">Please try again. If this keeps happening, contact support.</p>
        </div>
      </div>
    </div>
  )
}

const CRIT_COLOR: Record<string, string> = {
  critical: "#ef4444",
  high:     "#f97316",
  medium:   "#eab308",
  low:      "#22c55e",
  unknown:  "#71717a",
}

export function SystemGraph({
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

  const positions = useMemo(() => {
    if (!systems.length) return new Map<string, { x: number; y: number }>()
    const n = systems.length
    const pos = new Map<string, { x: number; y: number; vx: number; vy: number }>()

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
    <div ref={containerRef} className="relative bg-white dark:bg-zinc-950 overflow-hidden">
      <svg width="100%" height={GH} viewBox={`0 0 ${W} ${GH}`} style={{ display: "block" }}>
        <defs>
          <marker id="gph-arrow" markerWidth="7" markerHeight="7" refX="6.5" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7 Z" fill="#64748b" fillOpacity="0.55" />
          </marker>
        </defs>

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
          const x1 = from.x + (dx / dist) * rF
          const y1 = from.y + (dy / dist) * rF
          const x2 = to.x   - (dx / dist) * (rT + 8)
          const y2 = to.y   - (dy / dist) * (rT + 8)
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
              <circle cx={pos.x} cy={pos.y} r={r + 7} fill={color} fillOpacity={0.1} />
              <circle cx={pos.x} cy={pos.y} r={r} fill={color} fillOpacity={0.88} />
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

      <div className="px-4 py-2.5 border-t border-slate-100 dark:border-zinc-900 flex flex-wrap items-center gap-3">
        {(["critical", "high", "medium", "low", "unknown"] as const)
          .filter(lvl => systems.some(s => (s.criticality || "unknown") === lvl))
          .map(lvl => (
            <div key={lvl} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full block shrink-0" style={{ background: CRIT_COLOR[lvl] }} />
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
