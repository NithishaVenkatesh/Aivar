"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { useDropzone } from "react-dropzone"
import type { ThreadItem, DiscoveryResult, GapReport, GeneratedBundle } from "./types"
import { ThreadItemView } from "./components/ThreadItemView"
import { consumeSSE } from "../lib/sse"
import { mapDiscoverLog, mapAnalyzeLog, mapGenerateLog } from "../lib/logMapper"

export default function HomePage() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null)
  const [thread, setThread] = useState<ThreadItem[]>([
    { kind: "welcome", id: "welcome" },
  ])
  const [files, setFiles] = useState<File[]>([])
  const [useCaseText, setUseCaseText] = useState("")
  const [isRunning, setIsRunning] = useState(false)

  const threadBottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const saved = localStorage.getItem("aivar-theme") as "light" | "dark" | null
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
    setTheme(saved ?? (prefersDark ? "dark" : "light"))
  }, [])

  useEffect(() => {
    if (!theme) return
    if (theme === "dark") {
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
    }
  }, [theme])

  const toggleTheme = () => {
    if (!theme) return
    const next = theme === "light" ? "dark" : "light"
    setTheme(next)
    localStorage.setItem("aivar-theme", next)
  }

  // Auto-scroll to bottom when new thread items are added
  useEffect(() => {
    threadBottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [thread.length])

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`
  }, [useCaseText])

  const appendThread = useCallback((item: ThreadItem) => {
    setThread(prev => [...prev, item])
  }, [])

  const replaceThread = useCallback((id: string, newItem: ThreadItem) => {
    setThread(prev => prev.map(item => item.id === id ? newItem : item))
  }, [])

  const pushFeed = useCallback((id: string, line: string) => {
    setThread(prev => prev.map(item =>
      item.kind === "thinking" && item.id === id
        ? { ...item, feed: [...item.feed, line] }
        : item
    ))
  }, [])

  const onDrop = useCallback((accepted: File[]) => {
    setFiles(prev => {
      const names = new Set(prev.map(f => f.name))
      return [...prev, ...accepted.filter(f => !names.has(f.name))]
    })
  }, [])

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
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

  const removeFile = (name: string) => setFiles(prev => prev.filter(f => f.name !== name))

  const canSubmit = files.length > 0 && useCaseText.trim().length > 0 && !isRunning

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return

    setIsRunning(true)
    const currentFiles = [...files]
    const currentText = useCaseText

    setFiles([])
    setUseCaseText("")

    const uid = crypto.randomUUID()
    appendThread({ kind: "user", id: uid, text: currentText, fileNames: currentFiles.map(f => f.name) })

    // ---- Level 1: Discovery ----
    const l1Id = crypto.randomUUID()
    appendThread({ kind: "thinking", id: l1Id, stage: "l1", label: "Mapping your systems...", feed: [] })

    const form = new FormData()
    currentFiles.forEach(f => form.append("files", f))

    let inventory: DiscoveryResult
    try {
      const res = await fetch("/api/discover", { method: "POST", body: form })
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}))
        replaceThread(l1Id, { kind: "error", id: l1Id, stage: "l1", message: (data as { error?: string }).error ?? "Discovery failed" })
        setIsRunning(false)
        return
      }
      inventory = await consumeSSE<DiscoveryResult>(res, msg => {
        pushFeed(l1Id, mapDiscoverLog(msg) ?? msg)
      })
      replaceThread(l1Id, { kind: "l1", id: l1Id, result: inventory })
    } catch (err) {
      replaceThread(l1Id, {
        kind: "error", id: l1Id, stage: "l1",
        message: err instanceof Error ? err.message : "Discovery failed",
      })
      setIsRunning(false)
      return
    }

    // ---- Level 2: Gap analysis ----
    const l2Id = crypto.randomUUID()
    appendThread({ kind: "thinking", id: l2Id, stage: "l2", label: "Analysing your goals...", feed: [] })

    let report: GapReport
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inventory, use_cases: currentText }),
      })
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}))
        replaceThread(l2Id, { kind: "error", id: l2Id, stage: "l2", message: (data as { error?: string }).error ?? "Analysis failed" })
        setIsRunning(false)
        return
      }
      report = await consumeSSE<GapReport>(res, msg => {
        pushFeed(l2Id, mapAnalyzeLog(msg) ?? msg)
      })
      replaceThread(l2Id, { kind: "l2", id: l2Id, report })
    } catch (err) {
      replaceThread(l2Id, {
        kind: "error", id: l2Id, stage: "l2",
        message: err instanceof Error ? err.message : "Analysis failed",
      })
      setIsRunning(false)
      return
    }

    // ---- Level 3: Generate connectors (only if gaps exist) ----
    if (report.missing_integrations > 0) {
      const l3Id = crypto.randomUUID()
      appendThread({ kind: "thinking", id: l3Id, stage: "l3", label: "Building your integrations...", feed: [] })

      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inventory, gap_report: report }),
        })
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}))
          replaceThread(l3Id, { kind: "error", id: l3Id, stage: "l3", message: (data as { error?: string }).error ?? "Generation failed" })
          setIsRunning(false)
          return
        }
        const generated = await consumeSSE<{ bundles: GeneratedBundle[] }>(res, msg => {
          pushFeed(l3Id, mapGenerateLog(msg) ?? msg)
        })
        replaceThread(l3Id, { kind: "l3", id: l3Id, bundles: generated.bundles })
      } catch (err) {
        replaceThread(l3Id, {
          kind: "error", id: l3Id, stage: "l3",
          message: err instanceof Error ? err.message : "Generation failed",
        })
      }
    }

    setIsRunning(false)
  }, [canSubmit, files, useCaseText, appendThread, replaceThread, pushFeed])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const isFirstRun = thread.length === 1

  return (
    <div
      {...getRootProps()}
      className="flex flex-col h-screen bg-slate-50 dark:bg-black text-slate-900 dark:text-white relative overflow-hidden"
    >
      <input {...getInputProps()} />

      {/* Drag overlay */}
      {isDragActive && (
        <div className="absolute inset-0 z-50 bg-brand-500/10 dark:bg-brand-400/10 border-2 border-dashed border-brand-400 dark:border-brand-500 pointer-events-none flex items-center justify-center">
          <div className="bg-white dark:bg-zinc-950 rounded-2xl px-8 py-6 shadow-xl border border-brand-200 dark:border-brand-800 text-center">
            <p className="text-base font-bold text-brand-700 dark:text-brand-300">Drop files to attach</p>
            <p className="text-xs text-brand-500 dark:text-brand-500 mt-1">PDF, Word, PowerPoint, Excel, Markdown, images</p>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="shrink-0 bg-white dark:bg-zinc-950 border-b border-slate-200 dark:border-zinc-900 px-5 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-brand-500 flex items-center justify-center text-white font-black text-xs shadow-sm select-none">
            B
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-slate-900 dark:text-white leading-none">Bridgent</h1>
            <p className="text-[11px] text-slate-400 dark:text-zinc-600 mt-0.5 leading-none">Integration discovery</p>
          </div>
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

      {/* Thread */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-6 space-y-4">
          {thread.map(item => (
            <ThreadItemView key={item.id} item={item} />
          ))}
          <div ref={threadBottomRef} />
        </div>
      </div>

      {/* Input bar */}
      <div className="shrink-0 bg-white dark:bg-zinc-950 border-t border-slate-200 dark:border-zinc-900 shadow-lg">
        <div className="max-w-4xl mx-auto px-6 py-3">

          {/* File chips */}
          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {files.map(f => (
                <span
                  key={f.name}
                  className="flex items-center gap-1 px-2 py-1 bg-slate-100 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-full text-xs font-medium text-slate-700 dark:text-zinc-300"
                >
                  <svg className="w-3 h-3 shrink-0 text-slate-400 dark:text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="max-w-[160px] truncate">{f.name}</span>
                  <button
                    onClick={() => removeFile(f.name)}
                    disabled={isRunning}
                    className="ml-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 transition-colors disabled:opacity-40"
                    aria-label={`Remove ${f.name}`}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Input row */}
          <div className="flex items-end gap-2">
            {/* Attach button */}
            <button
              onClick={open}
              disabled={isRunning}
              className="shrink-0 w-9 h-9 flex items-center justify-center rounded-xl border border-slate-300 dark:border-zinc-700 text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-900 transition-colors disabled:opacity-40 bg-white dark:bg-zinc-950 mb-0.5"
              aria-label="Attach files"
              title="Attach documents"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={useCaseText}
              onChange={e => setUseCaseText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isRunning}
              placeholder={isFirstRun
                ? "Describe what you want to automate, then attach your documents…"
                : "Describe another goal or attach more documents…"
              }
              rows={1}
              className="flex-1 rounded-xl border border-slate-300 dark:border-zinc-700 px-3.5 py-2.5 text-sm text-slate-800 dark:text-zinc-100
                placeholder:text-slate-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500
                disabled:opacity-50 resize-none bg-white dark:bg-zinc-900 transition-colors duration-150 leading-relaxed"
              style={{ minHeight: "40px", maxHeight: "150px" }}
            />

            {/* Send button */}
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="shrink-0 w-9 h-9 flex items-center justify-center rounded-xl bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800
                disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm mb-0.5"
              aria-label="Send"
            >
              {isRunning ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
              )}
            </button>
          </div>

          {/* Hint text */}
          <p className="mt-1.5 text-[11px] text-slate-400 dark:text-zinc-600 text-center">
            {files.length === 0 && !isRunning && "Attach documents with the clip icon · Enter to send"}
            {files.length > 0 && !useCaseText.trim() && !isRunning && "Describe your automation goal · Enter to send"}
            {isRunning && "Analysis in progress…"}
          </p>
        </div>
      </div>
    </div>
  )
}
