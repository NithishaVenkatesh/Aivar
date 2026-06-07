import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Discovery Agent — Aivar",
  description: "Enterprise system discovery from documents",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  )
}
