import { NextRequest } from "next/server"
import { spawn } from "child_process"
import { writeFile, mkdir, rm } from "fs/promises"
import path from "path"
import os from "os"

export async function POST(req: NextRequest) {
  const { inventory, gap_report } = await req.json()

  if (!inventory || !gap_report) {
    return Response.json({ error: "Missing inventory or gap_report" }, { status: 400 })
  }

  const tmpDir = path.join(os.tmpdir(), `aivar_l3_${Date.now()}`)
  await mkdir(tmpDir, { recursive: true })

  const inventoryPath = path.join(tmpDir, "inventory.json")
  const gapReportPath = path.join(tmpDir, "gap_report.json")

  try {
    await writeFile(inventoryPath, JSON.stringify(inventory))
    await writeFile(gapReportPath, JSON.stringify(gap_report))
  } catch (err) {
    await rm(tmpDir, { recursive: true, force: true })
    return Response.json({ error: "Failed to write temp files" }, { status: 500 })
  }

  const encoder = new TextEncoder()
  const projectRoot = path.join(process.cwd(), "..")
  const scriptPath = path.join(projectRoot, "run_level3.py")

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          // client disconnected
        }
      }

      const proc = spawn("python", ["-u", scriptPath, inventoryPath, gapReportPath], {
        cwd: projectRoot,
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      })

      let stdout = ""

      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString()
      })

      proc.stderr.on("data", (chunk: Buffer) => {
        const lines = chunk.toString().split("\n").filter(Boolean)
        for (const line of lines) {
          send({ type: "log", message: line })
        }
      })

      proc.on("close", async (code: number | null) => {
        if (code !== 0) {
          send({ type: "error", message: `Level 3 pipeline exited with code ${code ?? "unknown"}` })
        } else {
          try {
            send({ type: "result", data: JSON.parse(stdout) })
          } catch {
            send({ type: "error", message: "Failed to parse Level 3 output" })
          }
        }
        await rm(tmpDir, { recursive: true, force: true })
        controller.close()
      })

      proc.on("error", async (err: Error) => {
        send({ type: "error", message: err.message })
        await rm(tmpDir, { recursive: true, force: true })
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  })
}
