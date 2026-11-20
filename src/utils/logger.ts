import pino from 'pino'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface AppLogger {
  debug(message: string, ...args: any[]): void
  info(message: string, ...args: any[]): void
  warn(message: string, ...args: any[]): void
  error(message: string, ...args: any[]): void
  child(bindings: Record<string, any>): AppLogger
}

const isProduction = process.env.NODE_ENV === 'production'
const defaultLogLevel = (process.env.LOG_LEVEL as LogLevel) || (isProduction ? 'info' : 'debug')

// GCP Cloud Logging severity mapping
const levelToGcpSeverity: Record<string, string> = {
  trace: 'DEBUG',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
}

/**
 * Base Pino logger configured for both Google Cloud Run (JSON with GCP severity)
 * and local terminal / testing environments.
 */
const basePino = pino({
  level: defaultLogLevel,
  messageKey: 'message',
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  formatters: {
    level(label, number) {
      if (isProduction) {
        return {
          level: number,
          severity: levelToGcpSeverity[label] || 'INFO',
        }
      }
      return { level: label.toUpperCase() }
    },
  },
})

/**
 * Normalizes variadic logger inputs (supports strings, error objects, metadata dicts)
 */
function normalizeLogArgs(message: string, ...args: any[]): { msg: string; meta?: Record<string, any>; err?: Error } {
  let msg = message
  let meta: Record<string, any> | undefined
  let err: Error | undefined

  if (args.length > 0) {
    for (const arg of args) {
      if (arg instanceof Error) {
        err = arg
      } else if (typeof arg === 'object' && arg !== null) {
        meta = { ...meta, ...arg }
      } else if (arg !== undefined) {
        msg += ` ${String(arg)}`
      }
    }
  }

  return { msg, meta, err }
}

class PinoAppLogger implements AppLogger {
  constructor(private pinoInstance: pino.Logger, private moduleName?: string) {}

  public debug(message: string, ...args: any[]): void {
    const { msg, meta, err } = normalizeLogArgs(message, ...args)
    const payload = { ...(this.moduleName ? { module: this.moduleName } : {}), ...meta, ...(err ? { err } : {}) }
    this.pinoInstance.debug(payload, msg)
  }

  public info(message: string, ...args: any[]): void {
    const { msg, meta, err } = normalizeLogArgs(message, ...args)
    const payload = { ...(this.moduleName ? { module: this.moduleName } : {}), ...meta, ...(err ? { err } : {}) }
    this.pinoInstance.info(payload, msg)
  }

  public warn(message: string, ...args: any[]): void {
    const { msg, meta, err } = normalizeLogArgs(message, ...args)
    const payload = { ...(this.moduleName ? { module: this.moduleName } : {}), ...meta, ...(err ? { err } : {}) }
    this.pinoInstance.warn(payload, msg)
  }

  public error(message: string, ...args: any[]): void {
    const { msg, meta, err } = normalizeLogArgs(message, ...args)
    const payload = { ...(this.moduleName ? { module: this.moduleName } : {}), ...meta, ...(err ? { err } : {}) }
    this.pinoInstance.error(payload, msg)
  }

  public child(bindings: Record<string, any>): AppLogger {
    const childPino = this.pinoInstance.child(bindings)
    const mod = bindings.module || this.moduleName
    return new PinoAppLogger(childPino, mod)
  }
}

/**
 * Creates a module-scoped logger with info, warn, error, and debug methods.
 * @param moduleName - The name of the module or component (e.g. 'PaperTrader', 'EquityAnalystAgent')
 */
export function createLogger(moduleName: string): AppLogger {
  return new PinoAppLogger(basePino.child({ module: moduleName }), moduleName)
}

/**
 * Default global application logger.
 */
export const logger: AppLogger = new PinoAppLogger(basePino)
export default logger
