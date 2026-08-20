/**
 * Command definitions for `/side` and `/btw`.
 *
 * Both commands fork the current session and return a client-observable
 * success marker as soon as the child accepts its initial prompt. A `/btw`
 * run is released in the background after its result settles so the command
 * never holds the parent turn open.
 */

import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import {
  askSideOneShot,
  formatSideList,
  startSideConversation,
  type SideDeps,
  type SubagentsLike,
} from './side.ts'

/** Narrow settlement seam owned by the host integration. */
export interface SettlementSilenceLike {
  noteChild(childId: string): void
}

/** Build the `/side` and `/btw` command definitions. */
export function createSidechainCommands(
  subagents: SubagentsLike,
  deps: SideDeps,
  settlementSilence: SettlementSilenceLike,
): CommandDefinition[] {
  const missingProvider = (): string | undefined => {
    if (subagents.getProvider(deps.providerName) !== undefined) return undefined
    return `sidechain: provider "${deps.providerName}" is not registered — mount @deepseek-ai/dsh-subagent-fork (or set providerName in the plugin config).`
  }

  return [
    {
      name: 'side',
      description: 'Start a side conversation in an ephemeral fork of the current session',
      recordInput: false,
      input: { hint: '<question>' },
      handler: async ({ agent, rawInput, signal }) => {
        const missing = missingProvider()
        if (missing !== undefined) return { kind: 'error', text: missing }

        const question = rawInput.trim()
        if (question === 'list' || question === 'ls') {
          try {
            const entries = await subagents.listChildren(agent.session.id, signal)
            return { kind: 'success', text: formatSideList(entries) }
          } catch (error) {
            return {
              kind: 'error',
              text: `sidechain: failed to list side conversations: ${messageOf(error)}`,
            }
          }
        }
        if (question === '') {
          return { kind: 'error', text: '/side requires a question: /side <question>' }
        }

        try {
          const { childId } = await startSideConversation(subagents, agent, question, deps, signal)
          settlementSilence.noteChild(childId)
          return { kind: 'success', text: `Side conversation started: ${childId}.` }
        } catch (error) {
          return {
            kind: 'error',
            text: `sidechain: failed to start side conversation: ${messageOf(error)}`,
          }
        }
      },
    },
    {
      name: 'btw',
      description: 'Ask a quick question in an ephemeral fork of the current session',
      recordInput: false,
      input: { hint: '<question>' },
      handler: async ({ agent, rawInput, signal }) => {
        const question = rawInput.trim()
        if (question === '') {
          return { kind: 'error', text: '/btw requires a question: /btw <question>' }
        }

        const missing = missingProvider()
        if (missing !== undefined) return { kind: 'error', text: missing }

        try {
          const run = await askSideOneShot(subagents, agent, question, deps, signal)
          settlementSilence.noteChild(run.id)
          // Keep the parent command free while the child streams. The run's
          // durable transcript remains available after this release.
          void run.result
            .catch(() => { /* release even when the child fails */ })
            .then(() => run.dispose().catch(() => { /* never mask the result */ }))
          return { kind: 'success', text: `BTW question started: ${run.id}.` }
        } catch (error) {
          return { kind: 'error', text: `sidechain: /btw failed: ${messageOf(error)}` }
        }
      },
    },
  ]
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
