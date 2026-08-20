/**
 * Portions of this file are adapted from @dsh-external/dsh-sidechain,
 * Copyright (c) 2026, dsh-external contributors, under the BSD-3-Clause
 * License. See THIRD_PARTY_NOTICES for the complete notice.
 */

import type { Context } from 'cordis'
import * as nodeFs from 'node:fs'

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
  logger?: {
    error?: (...args: unknown[]) => unknown
    warn?: (...args: unknown[]) => unknown
  }
}

export interface SettlementRegistryFileSystem {
  readFileSync(path: string, encoding: 'utf8'): string
  writeFileSync(path: string, data: string, encoding: 'utf8'): void
  renameSync(from: string, to: string): void
  unlinkSync(path: string): void
}

interface AgentRestore {
  agent: AdmissionAgent
  descriptors: Partial<Record<AdmissionMethod, PropertyDescriptor>>
  hadOwnProperty: Set<AdmissionMethod>
}

interface MessageSource {
  kind?: unknown
  form?: unknown
  summary?: unknown
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
export function createSettlementSilenceRuntime(ctx: Context, initialChildIds: Iterable<string> = []): {
  noteChild(childId: string): void
  dispose(): void
} {
  const runtimeCtx = ctx as unknown as RuntimeContext
  const childIds = new Set(initialChildIds)
  const restores = new Map<AdmissionAgent, AgentRestore>()
  let disposed = false

  const shouldSuppress = (message: unknown): boolean => {
    if (message === null || typeof message !== 'object') return false
    const source = (message as { source?: MessageSource }).source
    if (source === null || typeof source !== 'object') return false
    if (typeof source.senderSessionId !== 'string' || !childIds.has(source.senderSessionId)) return false
    if (source.kind === 'subagent-report') return source.form === 'relay'
    if (source.kind === 'subagent-settled') {
      return source.form === 'notice' && typeof source.summary === 'string'
    }
    return false
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

export interface SettlementSilenceOptions {
  registryPath: string
}

const nodeRegistryFileSystem: SettlementRegistryFileSystem = {
  readFileSync: (path, encoding) => nodeFs.readFileSync(path, encoding),
  writeFileSync: (path, data, encoding) => nodeFs.writeFileSync(path, data, encoding),
  renameSync: (from, to) => nodeFs.renameSync(from, to),
  unlinkSync: (path) => nodeFs.unlinkSync(path),
}

function logRegistryWarning(runtimeCtx: RuntimeContext, message: string, error: unknown): void {
  try {
    if (runtimeCtx.logger?.warn) {
      runtimeCtx.logger.warn(message, error)
    }
  } catch {
    // Logging must not make registry recovery fail.
  }
}

function loadChildIds(
  runtimeCtx: RuntimeContext,
  registryPath: string,
  fileSystem: SettlementRegistryFileSystem,
): Set<string> {
  let contents: string
  try {
    contents = fileSystem.readFileSync(registryPath, 'utf8')
  } catch (error) {
    if ((error as { code?: unknown }).code !== 'ENOENT') {
      logRegistryWarning(runtimeCtx, '[dsh-better-sidebar] failed to load settlement registry', error)
    }
    return new Set()
  }

  try {
    const parsed: unknown = JSON.parse(contents)
    if (!Array.isArray(parsed)) {
      throw new Error('registry is not an array')
    }
    if (!parsed.every((childId): childId is string => typeof childId === 'string')) {
      throw new Error('registry contains a non-string child ID')
    }
    return new Set(parsed)
  } catch (error) {
    logRegistryWarning(runtimeCtx, '[dsh-better-sidebar] ignoring malformed settlement registry', error)
    return new Set()
  }
}

function createSettlementSilenceWithFileSystem(
  ctx: Context,
  { registryPath }: SettlementSilenceOptions,
  fileSystem: SettlementRegistryFileSystem,
): { noteChild(childId: string): void; dispose(): void } {
  const runtimeCtx = ctx as unknown as RuntimeContext
  const childIds = loadChildIds(runtimeCtx, registryPath, fileSystem)
  const runtime = createSettlementSilenceRuntime(ctx, childIds)
  let disposed = false
  const tempPath = `${registryPath}.dsh-sidebar-tmp-${process.pid}`

  const reportPersistenceFailure = (error: unknown): void => {
    const message = '[dsh-better-sidebar] failed to persist settlement registry'
    try {
      if (runtimeCtx.logger?.error) {
        runtimeCtx.logger.error(message, error)
      } else {
        console.error(message, error)
      }
    } catch {
      // Persistence reporting is best effort too.
    }
  }

  const persist = (): void => {
    try {
      fileSystem.writeFileSync(tempPath, JSON.stringify([...childIds]), 'utf8')
      fileSystem.renameSync(tempPath, registryPath)
    } catch (error) {
      try {
        fileSystem.unlinkSync(tempPath)
      } catch {
        // The temp file may not have been created, or cleanup may fail.
      }
      reportPersistenceFailure(error)
    }
  }

  return {
    noteChild(childId: string): void {
      if (disposed || childIds.has(childId)) return
      runtime.noteChild(childId)
      childIds.add(childId)
      persist()
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      runtime.dispose()
    },
  }
}

/** Create process-local settlement silence with a synchronously persisted child registry. */
export function createSettlementSilence(
  ctx: Context,
  options: SettlementSilenceOptions,
): { noteChild(childId: string): void; dispose(): void } {
  return createSettlementSilenceWithFileSystem(ctx, options, nodeRegistryFileSystem)
}

/** @internal Test-only filesystem seam; production callers should use createSettlementSilence. */
export function createSettlementSilenceForTest(
  ctx: Context,
  options: SettlementSilenceOptions,
  fileSystem: SettlementRegistryFileSystem,
): { noteChild(childId: string): void; dispose(): void } {
  return createSettlementSilenceWithFileSystem(ctx, options, fileSystem)
}
