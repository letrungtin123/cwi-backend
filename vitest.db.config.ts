import { defineConfig } from 'vitest/config'

// Database tests: real local PostgreSQL, every write rolled back (tests/db/rollbackDb.ts).
// Kept out of `npm test` so the build gate never depends on a running database.
export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    globals: false,
    include: ['tests/db/**/*.dbtest.ts'],
    testTimeout: 30_000,
  },
})
