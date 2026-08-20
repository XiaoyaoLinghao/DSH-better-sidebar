/**
 * Portions of this file are adapted from @dsh-external/dsh-sidechain,
 * Copyright (c) 2026, dsh-external contributors, under the BSD-3-Clause
 * License. See THIRD_PARTY_NOTICES for the complete notice.
 *
 * Pure folding of sidechain session events into display rows.
 */

import type { ToolCallView, ToolEventView, ToolResultView } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

export interface ToolDetail {
  callView?: ToolCallView | undefined
  resultView?: ToolResultView | undefined
  arguments?: string | undefined
  error?: { name: string; code: string } | undefined
}

export type TranscriptRow =
  | { kind: 'user'; seq: number; text: string }
  | { kind: 'assistant'; seq: number; text: string }
  | { kind: 'reasoning'; seq: number; text: string }
  | { kind: 'context'; seq: number; text: string; source: string | null; recall: boolean }
  | { kind: 'tool'; seq: number; name: string; failed: boolean; detail?: ToolDetail | undefined }

/** One event plus its optional host-computed tool presentation. */
export interface TranscriptEntry {
  event: SessionEvent
  view?: ToolEventView | undefined
}

const BOUNDARY_PREFIX = 'Side conversation boundary'

type ContextProvenance = { role: 'inject' | 'recall'; label: string | null }

/** Pure equivalent of the runtime's durable message-source projection. */
function contextProvenance(source: unknown): ContextProvenance {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return { role: 'inject', label: null }
  const record = source as Record<string, unknown>
  const kind = typeof record.kind === 'string' && record.kind.length > 0 ? record.kind : null
  if (kind === null) return { role: 'inject', label: null }
  const labels = (member: string, field: string): string[] => {
    const list = record[member]
    if (!Array.isArray(list)) return []
    const seen = new Set<string>()
    for (const value of list) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
      const label = (value as Record<string, unknown>)[field]
      if (typeof label === 'string' && label.length > 0) seen.add(label)
    }
    return [...seen]
  }
  switch (kind) {
    case 'session-reference': return { role: 'recall', label: labels('references', 'label').join(', ') || kind }
    case 'agent-instructions': return { role: 'inject', label: labels('changes', 'path').join(', ') || kind }
    case 'plugin': return { role: 'inject', label: typeof record.plugin === 'string' && record.plugin.length > 0 ? record.plugin : kind }
    case 'skill-invocation': return { role: 'inject', label: typeof record.name === 'string' && record.name.length > 0 ? record.name : kind }
    default: return { role: 'inject', label: kind }
  }
}

/** Return visible text blocks joined by blank lines; never return blank text. */
export function blockText(blocks: readonly ContentBlock[]): string {
  const text = blocks
    .map(block => (block.type === 'text' ? block.text : ''))
    .filter(part => part !== '')
    .join('\n\n')
  return text === '' ? '…' : text
}

function lastSeedEnd(events: readonly SessionEvent[]): number {
  for (let index = events.length - 1; index >= 0; index--) {
    if (events[index]?.type === 'session/end-seed') return index
  }
  return -1
}

/** Fold event rows into the compact sidechain transcript model. */
export function transcriptRows(entries: readonly TranscriptEntry[]): TranscriptRow[] {
  const events = entries.map(entry => entry.event)
  const seedEnd = lastSeedEnd(events)
  type RowRecord = { row: TranscriptRow; streamKey?: string; callId?: string }
  const records: RowRecord[] = []
  const streamRows = new Map<string, number>()
  const callRows = new Map<string, number>()

  // Structural replacement can remove rows around surviving tool/stream rows.
  // Rebuild both index maps after each replacement so later events always point
  // at the current record positions.
  const reindex = (): void => {
    streamRows.clear()
    callRows.clear()
    records.forEach((record, index) => {
      if (record.streamKey !== undefined) streamRows.set(record.streamKey, index)
      if (record.callId !== undefined) callRows.set(record.callId, index)
    })
  }

  for (let index = 0; index < events.length; index++) {
    if (index <= seedEnd) continue
    const event = events[index]!
    const view = entries[index]?.view
    switch (event.type) {
      case 'user/message': {
        const text = blockText(event.data.content)
        if (text.startsWith(BOUNDARY_PREFIX)) break
        const source = event.data.source as unknown
        const sourceKind = typeof source === 'object' && source !== null
          ? (source as Record<string, unknown>).kind
          : undefined
        if (sourceKind === undefined || sourceKind === 'user') {
          records.push({ row: { kind: 'user', seq: event.seq, text } })
        } else {
          const provenance = contextProvenance(source)
          records.push({ row: {
            kind: 'context',
            seq: event.seq,
            text,
            source: provenance.label,
            recall: provenance.role === 'recall',
          } })
        }
        break
      }
      case 'assistant/chunk': {
        const chunk = event.data.chunk
        if ((chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta') || chunk.text === '') break
        const kind = chunk.type === 'text-delta' ? 'assistant' : 'reasoning'
        const key = `${event.data.turn}:${event.data.step}:${chunk.index}:${kind}`
        const existing = streamRows.get(key)
        if (existing !== undefined) {
          const record = records[existing]
          const row = record?.row
          if (record !== undefined && row !== undefined && row.kind === kind) {
            record.row = { ...row, text: row.text + chunk.text }
          }
        } else {
          streamRows.set(key, records.length)
          records.push({ row: { kind, seq: event.seq, text: chunk.text }, streamKey: key })
        }
        break
      }
      case 'assistant/message': {
        const prefix = `${event.data.turn}:${event.data.step}:`
        const streamed = [...streamRows.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([, rowIndex]) => rowIndex)
        for (const key of [...streamRows.keys()]) {
          if (key.startsWith(prefix)) streamRows.delete(key)
        }
        const settled = event.data.message.content.flatMap((block): TranscriptRow[] => {
          if (block.type === 'reasoning' && block.text !== '') return [{ kind: 'reasoning', seq: event.seq, text: block.text }]
          if (block.type === 'text' && block.text !== '') return [{ kind: 'assistant', seq: event.seq, text: block.text }]
          return []
        })
        if (settled.length === 0 && event.data.message.content.length === 0) {
          settled.push({ kind: 'assistant', seq: event.seq, text: '…' })
        }
        if (streamed.length === 0) {
          records.push(...settled.map(row => ({ row })))
        } else {
          // Stream rows need not be adjacent: tool calls can be emitted between
          // chunks. Remove exactly the settled stream records, preserve every
          // unrelated row, and insert the assembled message at the first target.
          const targets = new Set(streamed)
          const replacement: RowRecord[] = []
          let inserted = false
          for (let rowIndex = 0; rowIndex < records.length; rowIndex++) {
            if (targets.has(rowIndex)) {
              if (!inserted) {
                replacement.push(...settled.map(row => ({ row })))
                inserted = true
              }
            } else {
              replacement.push(records[rowIndex]!)
            }
          }
          records.splice(0, records.length, ...replacement)
          reindex()
        }
        break
      }
      case 'tool/call': {
        const data = event.data
        callRows.set(data.callId, records.length)
        records.push({
          callId: data.callId,
          row: {
            kind: 'tool',
            seq: event.seq,
            name: data.name,
            failed: false,
            detail: {
              arguments: data.arguments,
              ...(view !== undefined && view.for === 'call' ? { callView: view.view } : {}),
            },
          },
        })
        break
      }
      case 'tool/result': {
        const data = event.data
        const resultBlock = data.message.content[0]
        const callId = resultBlock?.type === 'tool-result' ? resultBlock.toolCallId : undefined
        const rowIndex = callId === undefined ? undefined : callRows.get(callId)
        const error = data.error
        const failed = error !== undefined || (resultBlock?.type === 'tool-result' && resultBlock.isError === true)
        if (rowIndex !== undefined) {
          const record = records[rowIndex]
          const row = record?.row
          if (record !== undefined && row !== undefined && row.kind === 'tool') {
            record.row = {
              ...row,
              failed,
              detail: {
                ...row.detail,
                ...(view !== undefined && view.for === 'result' ? { resultView: view.view } : {}),
                ...(error === undefined ? {} : { error }),
              },
            }
          }
        } else if (failed) {
          records.push({ row: {
              kind: 'tool',
              seq: event.seq,
              name: 'tool',
              failed: true,
              ...(error === undefined ? {} : { detail: { error } }),
            },
          })
        }
        break
      }
      default:
        break
    }
  }
  return records.map(record => record.row)
}

/** Derive mutation paths from successful call presentations, once each. */
export function producedPaths(entries: readonly TranscriptEntry[]): string[] {
  const seedEnd = lastSeedEnd(entries.map(entry => entry.event))
  const failedCallIds = new Set<string>()
  for (let index = seedEnd + 1; index < entries.length; index++) {
    const event = entries[index]?.event
    if (event === undefined || event.type !== 'tool/result') continue
    const block = event.data.message.content[0]
    const callId = block?.type === 'tool-result' ? block.toolCallId : undefined
    if (callId === undefined) continue
    if (event.data.error !== undefined || (block?.type === 'tool-result' && block.isError === true)) failedCallIds.add(callId)
  }

  const paths: string[] = []
  const seen = new Set<string>()
  for (let index = seedEnd + 1; index < entries.length; index++) {
    const entry = entries[index]!
    const event = entry.event
    const view = entry.view
    if (event.type !== 'tool/call' || view === undefined || view.for !== 'call' || failedCallIds.has(event.data.callId)) continue
    const call = view.view
    const locations = call.card === 'diff'
      ? call.locations
      : call.card === 'generic' && call.kind === 'edit'
        ? call.locations
        : undefined
    if (locations === undefined) continue
    for (const location of locations) {
      if (seen.has(location.path)) continue
      seen.add(location.path)
      paths.push(location.path)
    }
  }
  return paths
}
