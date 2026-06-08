export class SSEError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SSEError"
  }
}

export async function consumeSSE<R>(
  res: Response,
  onLog: (msg: string) => void,
): Promise<R> {
  if (!res.body) throw new SSEError("No response body")

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let result: R | null = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue
      let event: { type: string; message?: string; data?: R }
      try { event = JSON.parse(line.slice(6)) } catch { continue }

      if (event.type === "log" && event.message) {
        onLog(event.message)
      } else if (event.type === "result" && event.data !== undefined) {
        result = event.data
      } else if (event.type === "error" && event.message) {
        throw new SSEError(event.message)
      }
    }
  }

  if (result === null) throw new SSEError("No result received from server")
  return result
}
