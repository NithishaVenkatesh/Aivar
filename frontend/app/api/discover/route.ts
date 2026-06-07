import { NextRequest } from "next/server"
import { spawn } from "child_process"
import { writeFile, mkdir, rm } from "fs/promises"
import path from "path"
import os from "os"

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const files = formData.getAll("files") as File[]

  if (!files.length) {
    return Response.json({ error: "No files uploaded" }, { status: 400 })
  }

  const tmpDir = path.join(os.tmpdir(), `aivar_${Date.now()}`)
  await mkdir(tmpDir, { recursive: true })

  const savedPaths: string[] = []
  try {
    for (const file of files) {
      const bytes = await file.arrayBuffer()
      const filePath = path.join(tmpDir, file.name)
      await writeFile(filePath, Buffer.from(bytes))
      savedPaths.push(filePath)
    }
  } catch (err) {
    await rm(tmpDir, { recursive: true, force: true })
    return Response.json({ error: "Failed to save uploaded files" }, { status: 500 })
  }

  const encoder = new TextEncoder()
  const projectRoot = path.join(process.cwd(), "..")
  const scriptPath = path.join(projectRoot, "run_pipeline.py")

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          // client disconnected
        }
      }

      // -u = unbuffered stdout/stderr so log lines arrive in real time
      const proc = spawn("python", ["-u", scriptPath, ...savedPaths], {
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
          send({ type: "error", message: `Pipeline exited with code ${code ?? "unknown"}` })
        } else {
          try {
            send({ type: "result", data: JSON.parse(stdout) })
          } catch {
            send({ type: "error", message: "Failed to parse pipeline output" })
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
