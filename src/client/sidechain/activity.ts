/**
 * Portions of this file are adapted from @dsh-external/dsh-sidechain,
 * Copyright (c) 2026, dsh-external contributors, under the BSD-3-Clause
 * License. See THIRD_PARTY_NOTICES for the complete notice.
 *
 * Pure activity-line derivation for running side-conversation rows. Everything
 * here is framework-free so the summary parser is unit-testable in isolation.
 */

import type { TranscriptRow } from './transcript.ts'

/** Read one activity round and publish successful non-empty lines after containing sibling failures. */
export async function readActivityRound<Row>(
  rows: readonly Row[],
  read: (row: Row) => Promise<string | null>,
  publish: (row: Row, line: string) => void,
): Promise<void> {
  await Promise.allSettled(rows.map(async row => {
    const line = await read(row)
    if (line !== null) publish(row, line)
  }))
}

/** Argument fields that summarize each known tool best (first-wins priority). */
const TOOL_ARG_FIELDS: Readonly<Record<string, string>> = {
  bash: 'command',
  terminal: 'command',
  grep: 'pattern',
  glob: 'pattern',
  read: 'path',
  str_replace_editor: 'command',
  edit: 'file_path',
  subagent: 'description',
}

/** Maximum code points kept in one salient argument preview. */
const TOOL_ARG_MAX = 60
/** Maximum code points kept in one assistant-text activity line. */
const ACTIVITY_TEXT_MAX = 140

/** Collapse whitespace to single spaces and cap the code-point length. */
function collapse(text: string, max: number): string {
  const normalized = text.trim().replace(/\s+/g, ' ')
  const chars = [...normalized]
  if (chars.length <= max) return normalized
  return chars.slice(0, max).join('') + '…'
}

/**
 * Return the single most informative argument of one tool call. Known tools
 * use their preferred field; unknown tools use the first parsed field and then
 * malformed/raw input as a bounded fallback.
 */
export function salientToolArg(name: string, argumentsRaw: string | undefined): string | undefined {
  if (argumentsRaw === undefined) return undefined
  let value: unknown
  try {
    value = JSON.parse(argumentsRaw)
  } catch {
    return collapse(argumentsRaw, TOOL_ARG_MAX)
  }
  if (value === null || typeof value !== 'object') return collapse(String(value), TOOL_ARG_MAX)
  const record = value as Record<string, unknown>
  const pick = TOOL_ARG_FIELDS[name]
  let chosen: unknown
  if (pick !== undefined && record[pick] !== undefined) {
    chosen = record[pick]
  } else {
    for (const key of Object.keys(record)) {
      chosen = record[key]
      break
    }
  }
  if (chosen === undefined) return undefined
  const text = typeof chosen === 'string' ? chosen : JSON.stringify(chosen)
  return collapse(text, TOOL_ARG_MAX)
}

/**
 * Derive one live activity line: latest assistant text takes precedence over
 * the latest non-failed tool call. Failed calls never speak for the child.
 */
export function lastActivity(rows: readonly TranscriptRow[]): string | undefined {
  let text: string | undefined
  let tool: string | undefined
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]
    if (row === undefined) continue
    if (text === undefined && row.kind === 'assistant') {
      const collapsed = collapse(row.text, ACTIVITY_TEXT_MAX)
      if (collapsed !== '') text = collapsed
    } else if (tool === undefined && row.kind === 'tool' && !row.failed) {
      const args = salientToolArg(row.name, row.detail?.arguments)
      tool = `🔧 ${row.name}${args !== undefined ? ` · ${args}` : ''}`
    }
    if (text !== undefined && tool !== undefined) break
  }
  return text ?? tool
}
