// Ids in URLs and queue messages are UUIDs (versions 1-5). Checking the shape first turns a bad id
// into a clear 4xx instead of a database error.
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value)
}
