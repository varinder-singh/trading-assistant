import type { RunDeadline } from './contracts.js'

export const END_NODE = '__END__' as const

export type GraphNodeHandler<S> = (state: S) => Promise<void> | void
export type GraphEdgeResolver<S> = (state: S) => string

export interface GraphExecutionHooks<S> {
  readonly deadline: RunDeadline
  readonly isSuperseded?: () => boolean
  readonly onExpiredOrCanceled?: (state: S, reason: 'expired' | 'canceled') => void
}

/**
 * Declarative StateGraph engine with tail-recursive node traversal,
 * fault-isolated parallel fan-out (Promise.allSettled), monotonic RunDeadline enforcement,
 * and claimVersion tick supersession cancellation (Ma & Wang Ch. 5 & Ch. 6).
 */
export class StateGraph<S> {
  private readonly nodes = new Map<string, GraphNodeHandler<S>>()
  private readonly edges = new Map<string, GraphEdgeResolver<S>>()
  private entryNodeId: string | null = null

  public setEntryPoint(nodeId: string): this {
    this.entryNodeId = nodeId
    return this
  }

  public addNode(nodeId: string, handler: GraphNodeHandler<S>): this {
    this.nodes.set(nodeId, handler)
    return this
  }

  /**
   * Registers a fault-isolated concurrent fan-out node using Promise.allSettled.
   * Individual branch failures are isolated via `onBranchError` so surviving specialists still fan-in.
   */
  public addParallelNode(
    nodeId: string,
    branches: readonly { readonly branchName: string; readonly execute: GraphNodeHandler<S> }[],
    onBranchError?: (branchName: string, error: unknown, state: S) => void
  ): this {
    this.nodes.set(nodeId, async (state: S) => {
      const results = await Promise.allSettled(branches.map((branch) => Promise.resolve(branch.execute(state))))
      results.map((res, idx) => {
        if (res.status === 'rejected' && onBranchError) {
          onBranchError(branches[idx]!.branchName, res.reason, state)
        }
        return null
      })
    })
    return this
  }

  public addEdge(fromNodeId: string, toNodeId: string): this {
    this.edges.set(fromNodeId, () => toNodeId)
    return this
  }

  public addConditionalEdge(fromNodeId: string, resolver: GraphEdgeResolver<S>): this {
    this.edges.set(fromNodeId, resolver)
    return this
  }

  public async run(state: S, hooks: GraphExecutionHooks<S>, maxSteps: number = 12): Promise<S> {
    if (!this.entryNodeId) {
      throw new Error('StateGraph has no entry point configured')
    }
    return this.executeStep(state, this.entryNodeId, hooks, 0, maxSteps)
  }

  private async executeStep(
    state: S,
    currentNodeId: string,
    hooks: GraphExecutionHooks<S>,
    stepCount: number,
    maxSteps: number
  ): Promise<S> {
    if (currentNodeId === END_NODE || stepCount >= maxSteps) {
      return state
    }

    if (hooks.isSuperseded && hooks.isSuperseded()) {
      hooks.onExpiredOrCanceled?.(state, 'canceled')
      return state
    }

    if (hooks.deadline.isExpired()) {
      hooks.onExpiredOrCanceled?.(state, 'expired')
      return state
    }

    const handler = this.nodes.get(currentNodeId)
    if (!handler) {
      throw new Error(`StateGraph node "${currentNodeId}" is not registered`)
    }

    await handler(state)

    if (hooks.isSuperseded && hooks.isSuperseded()) {
      hooks.onExpiredOrCanceled?.(state, 'canceled')
      return state
    }

    const nextResolver = this.edges.get(currentNodeId)
    const nextNodeId = nextResolver ? nextResolver(state) : END_NODE

    return this.executeStep(state, nextNodeId, hooks, stepCount + 1, maxSteps)
  }
}
