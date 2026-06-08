import { createZip, downloadZip } from "./zip"
import type { GeneratedBundle } from "../app/types"

export function bundleSlug(b: GeneratedBundle): string {
  return `${b.source_system}_to_${b.destination_system}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

export function bundleFiles(b: GeneratedBundle): { name: string; content: string }[] {
  const slug = bundleSlug(b)
  return [
    { name: `${slug}/connector.py`,      content: b.connector_code },
    { name: `${slug}/agent_def.yaml`,    content: b.agent_def_yaml },
    { name: `${slug}/test_connector.py`, content: b.test_code },
    { name: `${slug}/requirements.txt`,  content: b.requirements },
    { name: `${slug}/README.md`,         content: b.readme },
  ]
}

export function downloadBundle(b: GeneratedBundle): void {
  downloadZip(createZip(bundleFiles(b)), `${bundleSlug(b)}.zip`)
}

export function downloadAllBundles(bundles: GeneratedBundle[]): void {
  downloadZip(createZip(bundles.flatMap(bundleFiles)), "integrations.zip")
}

export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
