import type { Context } from 'cordis'

const ADMISSION_METHODS = ['followup', 'steer', 'inject'] as const
type AdmissionMethod = (typeof ADMISSION_METHODS)[number]

interface AdmissionAgent {
  id: string
  followup: (...args: unknown[]) => unknown
  steer: (...args: unknown[]) => unknown
  inject: (...args: unknown[]) => unknown
}

interface RuntimeContext {
  agents: { list(): AdmissionAgent[] }
  on(name: string, listener: (payload: { agent: AdmissionAgent }) => void): () => unknown
}

interface AgentRestore {
  agent: AdmissionAgent
  descriptors: Partial<Record<AdmissionMethod, PropertyDescriptor>>
  hadOwnProperty: Set<AdmissionMethod>
}

interface MessageSource {
  kind?: unknown
  senderSessionId?: unknown
}

/**
 * Keep sidechain-generated parent messages out of the parent's own history.
 *
 * This deliberately wraps the live Agent admission seam rather than listening
 * to session events: the message is rejected before it enters any inbox or
 * durable parent transcript. Persistence of the child set belongs to the
 * registry layer and is intentionally outside this process-local runtime.
 */
export function createSettlementSilenceRuntime(ctx: Context): {
  noteChild(childId: string): void
  dispose(): void
} {
  const runtimeCtx = ctx as unknown as RuntimeContext
  const childIds = new Set<string>()
  const restores = new Map<AdmissionAgent, AgentRestore>()
  let disposed = false

  const shouldSuppress = (message: unknown): boolean => {
    if (message === null || typeof message !== 'object') return false
    const source = (message as { source?: MessageSource }).source
    if (source === null || typeof source !== 'object') return false
    if (source.kind !== 'subagent-report' && source.kind !== 'subagent-settled') return false
    return typeof source.senderSessionId === 'string' && childIds.has(source.senderSessionId)
  }

  const wrapAgent = (agent: AdmissionAgent): void => {
    if (disposed || restores.has(agent)) return

    const descriptors: Partial<Record<AdmissionMethod, PropertyDescriptor>> = {}
    const hadOwnProperty = new Set<AdmissionMethod>()

    for (const method of ADMISSION_METHODS) {
      const descriptor = Object.getOwnPropertyDescriptor(agent, method)
      if (descriptor !== undefined) {
        descriptors[method] = descriptor
        hadOwnProperty.add(method)
      }
      const original = agent[method]
      if (typeof original !== 'function') continue

      const wrapped = function (this: AdmissionAgent, ...args: unknown[]): unknown {
        if (shouldSuppress(args[0])) return undefined
        return original.apply(this, args)
      }

      if (descriptor !== undefined && 'value' in descriptor) {
        Object.defineProperty(agent, method, { ...descriptor, value: wrapped })
      } else {
        Object.defineProperty(agent, method, {
          configurable: descriptor?.configurable ?? true,
          enumerable: descriptor?.enumerable ?? false,
          writable: true,
          value: wrapped,
        })
      }
    }

    restores.set(agent, { agent, descriptors, hadOwnProperty })
  }

  const restoreAgent = ({ agent, descriptors, hadOwnProperty }: AgentRestore): void => {
    for (const method of ADMISSION_METHODS) {
      if (hadOwnProperty.has(method)) {
        Object.defineProperty(agent, method, descriptors[method]!)
      } else {
        delete (agent as unknown as Record<AdmissionMethod, unknown>)[method]
      }
    }
  }

  for (const agent of runtimeCtx.agents.list()) wrapAgent(agent)
  const disposeCreatedListener = runtimeCtx.on('agent/created', ({ agent }) => wrapAgent(agent))

  return {
    noteChild(childId: string): void {
      if (!disposed) childIds.add(childId)
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      disposeCreatedListener()
      for (const restore of restores.values()) restoreAgent(restore)
      restores.clear()
      childIds.clear()
    },
  }
}
