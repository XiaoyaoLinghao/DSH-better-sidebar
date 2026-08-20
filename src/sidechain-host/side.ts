/**
 * Portions of this file are adapted from @dsh-external/dsh-sidechain,
 * Copyright (c) 2026, dsh-external contributors, under the BSD-3-Clause
 * License. See THIRD_PARTY_NOTICES for the complete notice.
 *
 * Pure side-conversation operations over ctx.subagents. Both commands fork
 * the current session and differ only in whether the child is one-shot or
 * continuable.
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  ContinuableStart,
  ContinuableStartSpec,
  SubagentListEntry,
  SubagentRun,
  SubagentStartRequest,
} from '@deepseek-ai/dsh-subagent'
import type { ToolRestriction } from '@deepseek-ai/dsh-tools'
import { SIDE_BOUNDARY_PROMPT, SIDE_MODE_LINE, sidePrompt, type SideMode } from './prompts.ts'

/** Minimal structural face of the subagent service consumed by this plugin. */
export interface SubagentsLike {
  start(name: string, request: SubagentStartRequest): Promise<SubagentRun>
  startContinuable(spec: ContinuableStartSpec): Promise<ContinuableStart>
  listChildren(parentSessionId: SessionId, signal?: AbortSignal): Promise<SubagentListEntry[]>
  getProvider(name: string): { readonly name: string } | undefined
}

/** Shared side-conversation configuration. */
export interface SideDeps {
  /** Provider name on ctx.subagents; the fork backend registers as fork. */
  providerName: string
  /** Optional persona shadowing the deployment persona in a child. */
  persona?: string
  /** Optional allow-list restriction applied to a child. */
  toolFilter?: ToolRestriction
}

/** Maximum number of Unicode code points kept in a durable child label. */
export const LABEL_MAX_CHARS = 48

/** Start one disposable side question (/btw). */
export function askSideOneShot(
  subagents: SubagentsLike,
  parent: Agent,
  question: string,
  deps: SideDeps,
  signal: AbortSignal,
): Promise<SubagentRun> {
  return subagents.start(deps.providerName, {
    label: `BTW: ${truncateLabel(question)}`,
    prompt: [sidePrompt(question, 'btw')],
    parent,
    signal,
    ...(deps.persona === undefined ? {} : { persona: deps.persona }),
    ...(deps.toolFilter === undefined ? {} : { toolFilter: deps.toolFilter }),
  })
}

/** Start a durable continuable side thread (/side). */
export function startSideConversation(
  subagents: SubagentsLike,
  parent: Agent,
  question: string,
  deps: SideDeps,
  signal: AbortSignal,
): Promise<ContinuableStart> {
  const label = truncateLabel(question) || 'Side conversation'
  return subagents.startContinuable({
    provider: deps.providerName,
    label,
    request: {
      prompt: [sidePrompt(question, 'side')],
      parent,
      ...(deps.persona === undefined ? {} : { persona: deps.persona }),
      ...(deps.toolFilter === undefined ? {} : { toolFilter: deps.toolFilter }),
    },
    signal,
  })
}

/** Normalize whitespace and cap a durable label at 48 Unicode code points. */
export function truncateLabel(text: string): string {
  const normalized = text.trim().replace(/\s+/g, ' ')
  const chars = [...normalized]
  return chars.length <= LABEL_MAX_CHARS
    ? normalized
    : `${chars.slice(0, LABEL_MAX_CHARS).join('')}…`
}

/** Render the direct-child catalog as readable lines for a side list. */
export function formatSideList(entries: readonly SubagentListEntry[]): string {
  if (entries.length === 0) {
    return 'No side conversations yet. Start one with /side <question>.'
  }
  return entries.map((entry) => {
    if (entry.kind === 'diagnostic') {
      return `- [unavailable] ${entry.id} (${entry.reason})`
    }
    const mode = entry.mode === 'continuable' ? 'side' : 'btw'
    const label = entry.mode === 'continuable' ? entry.label : (entry.label ?? '(one-shot)')
    return `- [${mode}/${entry.activity}] ${label} — ${entry.id}`
  }).join('\n')
}

// Keep these imports available to consumers that historically imported the
// pinned prompt values from the side module while the implementation moved.
export { SIDE_BOUNDARY_PROMPT, SIDE_MODE_LINE }
export type { SideMode }
