/**
 * Non-visual observer for native `/side` and `/btw` command lifecycles.
 *
 * Command rows are not a reliable lifecycle surface: blank sessions may not
 * mount them and a fast command can settle before its row is rendered.  This
 * contribution therefore reads the session snapshot from the input dock and
 * only owns discovery/reveal side effects; it renders no dock markup.
 */
import { useEffect, useRef } from 'react'
import type { CommandNode, ConversationSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { SidechainController } from './controller.ts'

export type SideCommandKind = 'side' | 'btw'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'

/** Resolve a child id only from the exact successful host marker. */
export function resolveChildSessionId(
  node: CommandNode,
  kind: SideCommandKind,
): SessionId | undefined {
  const text = node.outcome?.kind === 'success' ? node.outcome.text : undefined
  if (text === undefined) return undefined
  const marker = kind === 'side' ? 'Side conversation started' : 'BTW question started'
  return new RegExp(`^${marker}: (${UUID})\\.$`).exec(text)?.[1] as SessionId | undefined
}

/** Last resolved child id (or pending/failed `undefined`) per command id. */
export type ObservedSideCommands = ReadonlyMap<CommandNode['commandId'], SessionId | undefined>

/**
 * Fold one command snapshot into observer state.  An undefined previous map
 * is the hydration baseline and emits nothing.  Subsequent snapshots emit
 * post-mount settled commands, including a pending → success transition, and
 * recording the resolved id makes duplicate snapshots idempotent.
 */
export function observeCreatedChildren(
  previous: ObservedSideCommands | undefined,
  nodes: readonly CommandNode[],
  startedAt: number,
): { known: ObservedSideCommands; children: readonly SessionId[] } {
  const known = new Map(previous)
  const children: SessionId[] = []
  for (const node of nodes) {
    if (node.name !== 'side' && node.name !== 'btw') continue
    const child = resolveChildSessionId(node, node.name)
    if (
      previous !== undefined
      && node.time >= startedAt
      && child !== undefined
      && previous.get(node.commandId) !== child
    ) children.push(child)
    known.set(node.commandId, child)
  }
  return { known, children }
}

export interface SidechainCommandObserverProps {
  useSession: <S>(selector: (snapshot: ConversationSnapshot) => S, eq?: (a: S, b: S) => boolean) => S
  controller: SidechainController
}

interface ObservationState {
  sessionId: SessionId
  startedAt: number
  known: ObservedSideCommands
}

/** A null-rendering input-dock contribution that claims settled side children. */
export function SidechainCommandObserver({
  controller,
  useSession,
}: SidechainCommandObserverProps): null {
  const session = useSession(snapshot => snapshot)
  const stateRef = useRef<ObservationState | undefined>(undefined)
  const freshSession = stateRef.current?.sessionId !== session.sessionId
  if (freshSession) {
    stateRef.current = { sessionId: session.sessionId, startedAt: Date.now(), known: new Map() }
  }
  const state = stateRef.current!
  const commandNodes = session.nodes.filter((node): node is CommandNode => node.kind === 'command')
  const observed = observeCreatedChildren(freshSession ? undefined : state.known, commandNodes, state.startedAt)
  state.known = observed.known

  useEffect(() => {
    controller.resetSession(session.sessionId)
  }, [controller, session.sessionId])

  useEffect(() => {
    for (const childId of observed.children) {
      controller.claimSideChild(session.sessionId, childId)
    }
  }, [controller, observed.children, session.sessionId])

  return null
}
