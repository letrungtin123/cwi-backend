import type { Logger } from 'pino'

// Last-resort handlers for failures that escaped every other handler, shared by the API server and
// the workers. An unhandled promise rejection is logged and the process keeps running: one failed
// request or job must not take the whole process down. An uncaught exception leaves the process in
// an unknown state, so it is logged and the process exits; PM2 then restarts it.
export function installProcessGuards(logger: Logger, processName: string) {
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason, processName }, 'Unhandled promise rejection')
  })
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error, processName }, 'Uncaught exception, exiting')
    process.exit(1)
  })
}

// Pool error listener: an idle connection broke (for example Postgres restarted). The pool drops
// that connection and opens a new one on the next query, so logging is enough.
export function logIdlePoolError(logger: Logger, processName: string) {
  return (error: Error) => {
    logger.error({ err: error, processName }, 'Idle database connection failed')
  }
}
