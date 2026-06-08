"use client"

interface ThinkingBubbleProps {
  label: string
  feed: string[]
}

export function ThinkingBubble({ label, feed }: ThinkingBubbleProps) {
  const latest = feed.length > 0 ? feed[feed.length - 1] : label
  const history = feed.length > 1 ? feed.slice(0, -1).slice(-5).reverse() : []

  return (
    <div className="bg-white dark:bg-zinc-950 rounded-2xl rounded-tl-sm border border-slate-200 dark:border-zinc-900 px-4 py-3.5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="relative flex items-center justify-center shrink-0">
          <span className="absolute inline-flex h-8 w-8 rounded-full bg-brand-500/20 dark:bg-brand-400/15 agentic-pulse" />
          <div className="relative w-8 h-8 rounded-full bg-gradient-to-tr from-brand-500 to-brand-700 flex items-center justify-center shadow-sm">
            <svg className="w-4 h-4 text-white animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        </div>
        <p className="text-sm font-semibold text-slate-800 dark:text-zinc-100 flex-1 min-w-0">{latest}</p>
      </div>
      {history.length > 0 && (
        <div className="mt-2.5 pl-11 space-y-1.5">
          {history.map((msg, i) => (
            <p key={i} className="text-xs text-slate-400 dark:text-zinc-500 flex items-center gap-2">
              <span className="text-green-500 dark:text-green-400 font-bold shrink-0">✓</span>
              {msg}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
