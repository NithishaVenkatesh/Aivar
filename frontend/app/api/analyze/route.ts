import { NextRequest } from "next/server"
import { spawn } from "child_process"
import { writeFile, mkdir, rm } from "fs/promises"
import path from "path"
import os from "os"
import { mapAnalyzeLog } from "@/lib/logMapper"

export async function POST(req: NextRequest) {
  const { inventory, use_cases } = await req.json()

  if (!inventory || !use_cases?.trim()) {
    return Response.json({ error: "Missing inventory or use_cases" }, { status: 400 })
  }

  const tmpDir = path.join(os.tmpdir(), `aivar_l2_${Date.now()}`)
  await mkdir(tmpDir, { recursive: true })

  const inventoryPath = path.join(tmpDir, "inventory.json")
  const usecasesPath = path.join(tmpDir, "usecases.txt")

  try {
    await writeFile(inventoryPath, JSON.stringify(inventory))
    await writeFile(usecasesPath, use_cases)
  } catch (err) {
    await rm(tmpDir, { recursive: true, force: true })
    return Response.json({ error: "Failed to write temp files" }, { status: 500 })
  }

  const encoder = new TextEncoder()
  const projectRoot = path.join(process.cwd(), "..")
  const scriptPath = path.join(projectRoot, "run_level2.py")

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          // client disconnected
        }
      }

      const proc = spawn("python", ["-u", scriptPath, inventoryPath, usecasesPath], {
        cwd: projectRoot,
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      })

      let stdout = ""

      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString()
      })

      let stderrBuffer = ""
      proc.stderr.on("data", (chunk: Buffer) => {
        stderrBuffer += chunk.toString()
        const lines = stderrBuffer.split("\n")
        stderrBuffer = lines.pop() ?? ""
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          console.error("[analyze]", trimmed)
          
          const mapped = mapAnalyzeLog(trimmed)
          if (mapped) send({ type: "log", message: mapped })
        }
      })

      proc.on("close", async (code: number | null) => {
        if (code !== 0) {
          send({ type: "error", message: `Level 2 pipeline exited with code ${code ?? "unknown"}` })
        } else {
          try {
            send({ type: "result", data: JSON.parse(stdout) })
          } catch {
            send({ type: "error", message: "Failed to parse Level 2 output" })
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
