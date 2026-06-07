// Minimal ZIP encoder using STORED (uncompressed) compression.
// No external dependencies — works in any modern browser environment.

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0)
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function u16(n: number): number[] {
  return [n & 0xFF, (n >> 8) & 0xFF]
}

function u32(n: number): number[] {
  return [n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >>> 24) & 0xFF]
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(total)
  let pos = 0
  for (const a of parts) { out.set(a, pos); pos += a.length }
  return out
}

interface ZipEntry {
  nameBytes: Uint8Array
  data: Uint8Array
  crc: number
  offset: number
}

export function createZip(files: { name: string; content: string }[]): Uint8Array {
  const enc = new TextEncoder()
  const entries: ZipEntry[] = []
  const localParts: Uint8Array[] = []
  let offset = 0

  for (const file of files) {
    const nameBytes = enc.encode(file.name)
    const data = enc.encode(file.content)
    const crc = crc32(data)
    const size = data.length

    // Local file header — 30 bytes fixed + filename
    const lfh = new Uint8Array([
      0x50, 0x4B, 0x03, 0x04, // local file header signature
      0x14, 0x00,              // version needed (2.0)
      0x00, 0x00,              // general purpose bit flag
      0x00, 0x00,              // compression method: STORED
      0x00, 0x00,              // last mod time
      0x00, 0x00,              // last mod date
      ...u32(crc),             // crc-32
      ...u32(size),            // compressed size
      ...u32(size),            // uncompressed size
      ...u16(nameBytes.length),// filename length
      0x00, 0x00,              // extra field length
    ])

    entries.push({ nameBytes, data, crc, offset })
    localParts.push(lfh, nameBytes, data)
    offset += lfh.length + nameBytes.length + data.length
  }

  // Central directory — 46 bytes fixed + filename per entry
  const cdParts: Uint8Array[] = []
  for (const e of entries) {
    const size = e.data.length
    const cd = new Uint8Array([
      0x50, 0x4B, 0x01, 0x02, // central directory file header signature
      0x14, 0x00,              // version made by
      0x14, 0x00,              // version needed
      0x00, 0x00,              // general purpose bit flag
      0x00, 0x00,              // compression method: STORED
      0x00, 0x00,              // last mod time
      0x00, 0x00,              // last mod date
      ...u32(e.crc),           // crc-32
      ...u32(size),            // compressed size
      ...u32(size),            // uncompressed size
      ...u16(e.nameBytes.length), // filename length
      0x00, 0x00,              // extra field length
      0x00, 0x00,              // file comment length
      0x00, 0x00,              // disk number start
      0x00, 0x00,              // internal file attributes
      0x00, 0x00, 0x00, 0x00, // external file attributes
      ...u32(e.offset),        // relative offset of local header
    ])
    cdParts.push(cd, e.nameBytes)
  }

  const cdStart = offset
  const cdBytes = concat(cdParts)

  // End of central directory record — 22 bytes
  const eocd = new Uint8Array([
    0x50, 0x4B, 0x05, 0x06,  // end of central directory signature
    0x00, 0x00,               // disk number
    0x00, 0x00,               // disk with start of central directory
    ...u16(entries.length),   // total entries on this disk
    ...u16(entries.length),   // total entries
    ...u32(cdBytes.length),   // size of central directory
    ...u32(cdStart),          // offset of start of central directory
    0x00, 0x00,               // comment length
  ])

  return concat([...localParts, cdBytes, eocd])
}

export function downloadZip(zipBytes: Uint8Array, filename: string): void {
  const blob = new Blob([zipBytes.buffer as ArrayBuffer], { type: "application/zip" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
