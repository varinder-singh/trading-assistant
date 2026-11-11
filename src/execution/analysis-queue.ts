import { EventEmitter } from 'node:events'
import type { CandidateAlert } from '../data/kite-scanner.js'

export interface QueuedCandidate {
  candidate: CandidateAlert
  userId: string
  enqueuedAt: number
}

export type CandidateProcessor = (candidate: CandidateAlert, userId: string) => Promise<void>

export class AnalysisQueue extends EventEmitter {
  private queue: QueuedCandidate[] = []
  private isProcessing: boolean = false
  private activeSymbol: string | null = null
  private readonly maxQueueSize: number
  private readonly candidateTtlMs: number
  private readonly delayBetweenJobsMs: number

  constructor(options?: {
    maxQueueSize?: number
    candidateTtlMs?: number
    delayBetweenJobsMs?: number
  }) {
    super()
    this.maxQueueSize = options?.maxQueueSize ?? 20
    this.candidateTtlMs = options?.candidateTtlMs ?? 60000 // 60s
    this.delayBetweenJobsMs = options?.delayBetweenJobsMs ?? 1000 // 1s spacing to respect Kite API limits
  }

  public enqueue(candidate: CandidateAlert, userId: string, processor: CandidateProcessor): boolean {
    this.purgeStale()

    const upperSymbol = candidate.symbol.toUpperCase().trim()

    // Skip if currently being analyzed
    if (this.activeSymbol === upperSymbol) {
      return false
    }

    // Skip if already in queue
    const existingIndex = this.queue.findIndex((q) => q.candidate.symbol === upperSymbol)
    if (existingIndex !== -1) {
      // If new candidate has higher priority, update it in place
      if (candidate.priorityScore > this.queue[existingIndex]!.candidate.priorityScore) {
        this.queue[existingIndex] = { candidate, userId, enqueuedAt: Date.now() }
        this.sortByPriority()
      }
      return false
    }

    if (this.queue.length >= this.maxQueueSize) {
      const lowestPriority = this.queue[this.queue.length - 1]!
      if (candidate.priorityScore <= lowestPriority.candidate.priorityScore) {
        return false
      }
      this.queue.pop()
    }

    this.queue.push({ candidate, userId, enqueuedAt: Date.now() })
    this.sortByPriority()

    this.processNext(processor)
    return true
  }

  public getPendingCount(): number {
    this.purgeStale()
    return this.queue.length
  }

  public clear(): void {
    this.queue = []
    this.activeSymbol = null
  }

  private sortByPriority(): void {
    this.queue.sort((a, b) => b.candidate.priorityScore - a.candidate.priorityScore)
  }

  private purgeStale(): void {
    const now = Date.now()
    this.queue = this.queue.filter((q) => now - q.enqueuedAt <= this.candidateTtlMs)
  }

  private async processNext(processor: CandidateProcessor): Promise<void> {
    if (this.isProcessing) return
    this.purgeStale()

    if (this.queue.length === 0) {
      this.activeSymbol = null
      return
    }

    this.isProcessing = true
    const item = this.queue.shift()!
    this.activeSymbol = item.candidate.symbol

    try {
      this.emit('processing_start', item.candidate)
      await processor(item.candidate, item.userId)
      this.emit('processing_complete', item.candidate)
    } catch (err: any) {
      console.error(`[AnalysisQueue] ❌ Error processing candidate ${item.candidate.symbol}:`, err.message || err)
      this.emit('processing_error', { candidate: item.candidate, error: err })
    } finally {
      this.activeSymbol = null
      // Rate-limiting delay between candidate evaluations
      await new Promise((resolve) => setTimeout(resolve, this.delayBetweenJobsMs))
      this.isProcessing = false
      this.processNext(processor)
    }
  }
}

export const analysisQueue = new AnalysisQueue()
