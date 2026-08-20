/**
 * Presentational rows for the native `/side` and `/btw` commands.
 *
 * The command observer and the Sidechain tab own lifecycle and navigation.
 * This component only exposes the command's current status and result at the
 * chat row insertion point.
 */

import type { CommandRowOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { getSidechainLabels } from '../locales.ts'

/** Props supplied by the keyed conversation command-row slot. */
export type SideCommandCardProps = CommandRowOwnerProps

/** Render one sidechain command's status and optional result. */
export function SideCommandCard({ node }: SideCommandCardProps): JSX.Element {
  const labels = getSidechainLabels()
  const outcome = node.outcome
  const state = outcome === null ? 'running' : outcome.kind === 'error' ? 'failure' : 'success'
  const status = outcome === null
    ? labels.sidechainRunning
    : outcome.kind === 'error'
      ? labels.sidechainPromptFailed
      : labels.sidechainInactive
  const result = outcome?.text
  const command = node.name === 'side' || node.name === 'btw'
    ? `/${node.name}`
    : labels.sidechain

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-sidechain-command-card
      data-state={state}
    >
      <span data-command-name>{command}</span>
      <span data-command-status>{status}</span>
      {result !== undefined && <span data-command-result>{result}</span>}
    </div>
  )
}

/** One keyed contribution for each native sidechain command. */
export interface SidechainCommandCardContribution {
  key: 'side' | 'btw'
  component: typeof SideCommandCard
}

const SIDECHAIN_COMMAND_CARDS = [
  { key: 'side', component: SideCommandCard },
  { key: 'btw', component: SideCommandCard },
] as const satisfies readonly SidechainCommandCardContribution[]

/** Return the complete, fixed set of native sidechain command cards. */
export function createSidechainCommandCards(): readonly SidechainCommandCardContribution[] {
  return SIDECHAIN_COMMAND_CARDS
}
