"use client"

import type { ReactNode } from "react"
import type { ThreadItem } from "../types"
import { ErrorCard } from "./shared"
import { ThinkingBubble } from "./ThinkingBubble"
import { L1ResultCard } from "./L1ResultCard"
import { L2ResultCard } from "./L2ResultCard"
import { L3ResultCard } from "./L3ResultCard"

function AgentAvatar() {
  return (
    <div className="w-7 h-7 rounded-lg bg-brand-500 flex items-center justify-center text-white font-black text-xs shrink-0 shadow-sm select-none">
      B
    </div>
  )
}

function AgentMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <AgentAvatar />
      <div className="flex-1 min-w-0">
        {children}
      </div>
    </div>
  )
}

function WelcomeCard() {
  return (
    <div className="bg-white dark:bg-zinc-950 rounded-2xl rounded-tl-sm border border-slate-200 dark:border-zinc-900 px-5 py-4 shadow-sm">
      <p className="text-sm font-semibold text-slate-900 dark:text-white">Good to see you.</p>
      <p className="text-sm text-slate-600 dark:text-zinc-400 mt-1.5 leading-relaxed">
        Attach your company documents and describe what you want to automate. I&apos;ll map your technology stack, identify integration gaps, and build the connectors.
      </p>
      <p className="text-xs text-slate-400 dark:text-zinc-600 mt-2.5">
        Supports PDF, Word, PowerPoint, Excel, Markdown, plain text, and images.
      </p>
    </div>
  )
}

function UserMessage({ text, fileNames }: { text: string; fileNames: string[] }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-2xl bg-slate-100 dark:bg-zinc-900 rounded-2xl rounded-tr-sm px-4 py-3 border border-slate-200 dark:border-zinc-800">
        {fileNames.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2.5">
            {fileNames.map(name => (
              <span
                key={name}
                className="flex items-center gap-1 px-2 py-0.5 bg-white dark:bg-zinc-950 border border-slate-300 dark:border-zinc-700 rounded-full text-xs text-slate-600 dark:text-zinc-400 font-medium"
              >
                <svg className="w-3 h-3 shrink-0 text-slate-400 dark:text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                {name}
              </span>
            ))}
          </div>
        )}
        <p className="text-sm text-slate-800 dark:text-zinc-100 whitespace-pre-wrap leading-relaxed">{text}</p>
      </div>
    </div>
  )
}

export function ThreadItemView({ item }: { item: ThreadItem }) {
  switch (item.kind) {
    case "welcome":
      return (
        <AgentMessage>
          <WelcomeCard />
        </AgentMessage>
      )

    case "user":
      return <UserMessage text={item.text} fileNames={item.fileNames} />

    case "thinking":
      return (
        <AgentMessage>
          <ThinkingBubble label={item.label} feed={item.feed} />
        </AgentMessage>
      )

    case "error":
      return (
        <AgentMessage>
          <ErrorCard message={item.message} />
        </AgentMessage>
      )

    case "l1":
      return (
        <AgentMessage>
          <L1ResultCard result={item.result} />
        </AgentMessage>
      )

    case "l2":
      return (
        <AgentMessage>
          <L2ResultCard report={item.report} />
        </AgentMessage>
      )

    case "l3":
      return (
        <AgentMessage>
          <L3ResultCard bundles={item.bundles} />
        </AgentMessage>
      )
  }
}
