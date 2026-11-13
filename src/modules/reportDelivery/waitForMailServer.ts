type Logger = {
  error: (details: Record<string, unknown>, message: string) => void
  info: (details: Record<string, unknown>, message: string) => void
  warn: (details: Record<string, unknown>, message: string) => void
}

export type WaitForMailServerOptions = {
  // Longest pause between two attempts.
  maxDelayMs?: number
  // First pause; it doubles after each failed attempt up to maxDelayMs.
  firstDelayMs?: number
  // After this many failed attempts the log level becomes error, so monitoring notices it.
  errorAfterAttempts?: number
  isStopping: () => boolean
  logger: Logger
  sleep: (milliseconds: number) => Promise<void>
}

// The mail server (Microsoft 365) sometimes times out or answers "451 temporary server error"
// for a few minutes. The worker used to exit when the start-up check failed, and PM2 restarted
// it in a tight loop that logged in to the mail server again on every restart (21 restarts on
// 2026-11-13). Instead, keep the process and retry with a growing pause. Emails wait safely in
// RabbitMQ meanwhile. Returns false only when the worker is asked to stop while waiting.
export async function waitForMailServer(verify: () => Promise<unknown>, options: WaitForMailServerOptions): Promise<boolean> {
  const { errorAfterAttempts = 5, firstDelayMs = 30_000, isStopping, logger, maxDelayMs = 5 * 60_000, sleep } = options
  let delay = firstDelayMs
  for (let attempt = 1; !isStopping(); attempt += 1) {
    try {
      await verify()
      if (attempt > 1) logger.info({ attempt }, 'Mail server reachable again')
      return true
    } catch (error) {
      const details = { attempt, err: error, retryInMs: delay }
      // Called as methods: pino's log functions need their `this`.
      if (attempt >= errorAfterAttempts) logger.error(details, 'Mail server not reachable at start-up, retrying')
      else logger.warn(details, 'Mail server not reachable at start-up, retrying')
      // Sleep in short steps so a stop request is not delayed by a long pause.
      for (let waited = 0; waited < delay && !isStopping(); waited += 1000) await sleep(Math.min(1000, delay - waited))
      delay = Math.min(delay * 2, maxDelayMs)
    }
  }
  return false
}
