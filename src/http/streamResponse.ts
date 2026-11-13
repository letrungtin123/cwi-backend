import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Response } from 'express'

// Streams a stored file to the client. Once bytes have gone out no error response can be sent, so
// a failure half-way (storage dropped the connection, the client went away) only ends this one
// response. A bare .pipe(res) would instead raise an unhandled stream error and crash the process.
export async function streamToResponse(body: globalThis.ReadableStream<Uint8Array>, res: Response) {
  try {
    await pipeline(Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]), res)
  } catch (error) {
    if (!res.destroyed) res.destroy(error instanceof Error ? error : undefined)
  }
}
