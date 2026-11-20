import { describe, it, expect, vi } from 'vitest'
import { createLogger, logger } from '../src/utils/logger.js'

describe('Logger utility', () => {
  it('creates module-scoped logger with info, warn, error, and debug methods', () => {
    const log = createLogger('TestModule')
    expect(typeof log.info).toBe('function')
    expect(typeof log.warn).toBe('function')
    expect(typeof log.error).toBe('function')
    expect(typeof log.debug).toBe('function')
    expect(typeof log.child).toBe('function')
  })

  it('logs messages without throwing errors', () => {
    const log = createLogger('ExecutionEngine')
    expect(() => {
      log.info('Order placed successfully', { symbol: 'SUPREMEIND', price: 3194.3 })
      log.warn('RSI is approaching exhaustion', { symbol: 'HAL', rsi: 34.2 })
      log.error('Failed to communicate with broker', new Error('Network timeout'), { retries: 3 })
      log.debug('Processing tick', { token: 12345, ltp: 100.5 })
    }).not.toThrow()
  })

  it('creates child loggers with inherited bindings', () => {
    const parentLog = createLogger('Session')
    const childLog = parentLog.child({ userId: 'user-123' })
    expect(typeof childLog.info).toBe('function')
    expect(() => {
      childLog.info('User session activated')
    }).not.toThrow()
  })
})
