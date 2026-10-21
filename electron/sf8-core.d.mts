/* Types for sf8-core.mjs, which the renderer imports.

   The core is plain JavaScript on purpose - Electron's main process loads it
   directly, with no build step between them - so the types it presents to the
   TypeScript side live here instead of in its own source. */

export interface Sf8CoreCodec {
  inflateRaw: (bytes: Uint8Array) => Promise<Uint8Array>
  deflateRaw: (bytes: Uint8Array) => Promise<Uint8Array>
}

export interface Sf8CoreRow {
  lrn: string
  name: string
  birthDate: string
  weightKg: number | null
  heightCm: number | null
}

export interface Sf8CoreJob {
  header: Record<string, string>
  assessedOn: string
  males: Sf8CoreRow[]
  females: Sf8CoreRow[]
}

/** Rows the form reserves for one sex. */
export const CAPACITY: number

/** One archive member, with its still-compressed bytes kept as found. */
export interface Sf8ZipEntry {
  name: string
  method: number
  time: number
  date: number
  crc: number
  compSize: number
  rawSize: number
  compressed: Uint8Array
}

export function readZip(bytes: Uint8Array): Sf8ZipEntry[]
export function writeZip(entries: Sf8ZipEntry[]): Uint8Array
export function crc32(bytes: Uint8Array): number
export function excelSerial(iso: string): number | null

/** The workbook's BMI and HEIGHT tables, one array per row indexed like
    VLOOKUP's column argument minus one, plus the form's two header pictures. */
export interface Sf8FormAssets {
  bmi: number[][]
  height: number[][]
  seal: Uint8Array
  wordmark: Uint8Array
}

export function readSf8Form(args: {
  template: Uint8Array
  codec: Pick<Sf8CoreCodec, 'inflateRaw'>
}): Promise<Sf8FormAssets>

export function buildSf8(args: {
  template: Uint8Array
  codec: Sf8CoreCodec
  job: Sf8CoreJob
}): Promise<Uint8Array>
