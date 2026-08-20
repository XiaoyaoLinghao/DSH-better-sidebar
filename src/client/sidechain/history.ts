/**
 * Portions of this file are adapted from @dsh-external/dsh-sidechain,
 * Copyright (c) 2026, dsh-external contributors, under the BSD-3-Clause
 * License. See THIRD_PARTY_NOTICES for the complete notice.
 *
 * Activation-scoped reader for native rc.8 side-conversation history.
 *
 * The child log starts with an inherited fork seed.  History is therefore
 * read backwards in small pages until the latest `session/end-seed` marker is
 * found; only child-owned events are retained.  Caches deliberately live in
 * the factory instance so an activation can be disposed without leaking
 * transcript state into a later activation.
 */

import type { Context } from 'cordis'
import type {
  SidebarPromptContentBlock,
  SidebarSubagentAddress,
} from '../../context-types.ts'
import type { TranscriptEntry, TranscriptRow } from './transcript.ts'
import { producedPaths, transcriptRows } from './transcript.ts'
import { lastActivity } from './activity.ts'

export type SidechainApi = Pick<Context['connection']['api']['subagents'], 'history' | 'prompt'>
export type SidechainContinuableAddress = SidebarSubagentAddress & { mode: 'continuable' }

export interface SidechainTranscriptSnapshot {
  rows: readonly TranscriptRow[]
  produced: readonly string[]
  streaming: boolean
  hasMore: boolean
}

export interface SidechainHistory {
  fetchTranscript(address: SidebarSubagentAddress, signal?: AbortSignal): Promise<SidechainTranscriptSnapshot>
  fetchActivity(address: SidebarSubagentAddress, signal?: AbortSignal): Promise<string | null>
  sendPrompt(address: SidechainContinuableAddress, text: string, signal: AbortSignal): Promise<boolean>
  dispose(): void
}

export const TRANSCRIPT_PAGE_MESSAGES = 8
export const ACTIVITY_PAGE_MESSAGES = 6
export const ACTIVITY_PAGE_CAP = 4

type HistoryEntry = TranscriptEntry
type HistoryPage = {
  events: HistoryEntry[]
  hasMore: boolean
}

function lastSeedEnd(entries: readonly HistoryEntry[]): number {
  for (let index = entries.length - 1; index >= 0; index--) {
    if (entries[index]?.event.type === 'session/end-seed') return index
  }
  return -1
}

function isStreaming(entries: readonly HistoryEntry[]): boolean {
  const streams = new Set<string>()
  const pendingCalls = new Set<string>()
  for (const entry of entries) {
    const event = entry.event
    if (event.type === 'assistant/chunk') {
      const chunk = event.data.chunk
      if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
        streams.add(`${String(event.data.turn)}:${String(event.data.step)}`)
      }
    } else if (event.type === 'assistant/message') {
      streams.delete(`${String(event.data.turn)}:${String(event.data.step)}`)
    } else if (event.type === 'tool/call') {
      pendingCalls.add(event.data.callId)
    } else if (event.type === 'tool/result') {
      const block = event.data.message.content[0]
      if (block?.type === 'tool-result') pendingCalls.delete(block.toolCallId)
    }
  }
  return streams.size > 0 || pendingCalls.size > 0
}

/**
 * Create a reader whose caches belong only to this activation.
 */
export function createSidechainHistory(api: SidechainApi): SidechainHistory {
  const seedBoundaryCache = new Map<string, number>()
  const transcriptEntryCache = new Map<string, readonly HistoryEntry[]>()
  let disposed = false
  let generation = 0

  const fetchPage = async (
    address: SidebarSubagentAddress,
    maxMessages: number,
    beforeSeq: number | undefined,
    signal: AbortSignal | undefined,
  ): Promise<HistoryPage> => {
    const payload = {
      ...address,
      maxMessages,
      ...(beforeSeq === undefined ? {} : { beforeSeq }),
    }
    const response = signal === undefined
      ? await api.history(payload)
      : await api.history(payload, signal)
    if (!response.result.ok) {
      const error = response.result.error
      throw new Error(
        typeof error.message === 'string' && error.message !== ''
          ? error.message
          : typeof error.code === 'string' && error.code !== '' ? error.code : 'history request failed',
      )
    }
    return {
      events: response.result.value.events as HistoryEntry[],
      hasMore: response.result.value.hasMore,
    }
  }

  const fetchSeedCutEntries = async (
    address: SidebarSubagentAddress,
    pageMessages: number,
    pageCap: number | undefined,
    signal: AbortSignal | undefined,
  ): Promise<{ entries: readonly HistoryEntry[]; hasMore: boolean }> => {
    const childSessionId = address.childSessionId
    const cachedBoundary = seedBoundaryCache.get(childSessionId)
    const collected: HistoryEntry[] = []
    let beforeSeq: number | undefined
    let boundarySeq = cachedBoundary
    let hasMore = false
    const maxPages = pageCap ?? Number.POSITIVE_INFINITY

    for (let page = 0; page < maxPages; page++) {
      const result = await fetchPage(address, pageMessages, beforeSeq, signal)
      hasMore = hasMore || result.hasMore
      const events = result.events
      if (events.length === 0) break
      const olderThan = collected.length > 0 ? collected[0]!.event.seq : undefined
      const fresh = olderThan === undefined
        ? events
        : events.filter(entry => entry.event.seq < olderThan)
      const seedEnd = lastSeedEnd(fresh)
      if (seedEnd >= 0) {
        boundarySeq = fresh[seedEnd]!.event.seq
        if (!disposed) seedBoundaryCache.set(childSessionId, boundarySeq)
        collected.unshift(...fresh.slice(seedEnd + 1))
        break
      }
      if (boundarySeq !== undefined) {
        const boundary = boundarySeq
        collected.unshift(...fresh.filter(entry => entry.event.seq > boundary))
        break
      }
      collected.unshift(...fresh)
      if (fresh.length === 0) break
      beforeSeq = fresh[0]!.event.seq
    }

    if (boundarySeq !== undefined) {
      return { entries: collected.filter(entry => entry.event.seq > boundarySeq), hasMore }
    }
    return { entries: collected, hasMore }
  }

  const fetchTranscript = async (
    address: SidebarSubagentAddress,
    signal?: AbortSignal,
  ): Promise<SidechainTranscriptSnapshot> => {
    const operationGeneration = generation
    const result = await fetchSeedCutEntries(address, TRANSCRIPT_PAGE_MESSAGES, undefined, signal)

    const previous = transcriptEntryCache.get(address.childSessionId) ?? []
    const bySeq = new Map(previous.map(entry => [entry.event.seq, entry]))
    for (const entry of result.entries) bySeq.set(entry.event.seq, entry)
    const transcript = [...bySeq.values()].sort((a, b) => a.event.seq - b.event.seq)
    if (!disposed && operationGeneration === generation) {
      transcriptEntryCache.set(address.childSessionId, transcript)
    }
    return {
      rows: transcriptRows(transcript),
      produced: producedPaths(transcript),
      streaming: isStreaming(transcript),
      hasMore: result.hasMore,
    }
  }

  const fetchActivity = async (
    address: SidebarSubagentAddress,
    signal?: AbortSignal,
  ): Promise<string | null> => {
    try {
      const result = await fetchSeedCutEntries(address, ACTIVITY_PAGE_MESSAGES, ACTIVITY_PAGE_CAP, signal)
      return lastActivity(transcriptRows(result.entries)) ?? null
    } catch {
      return null
    }
  }

  const sendPrompt = async (
    address: SidechainContinuableAddress,
    text: string,
    signal: AbortSignal,
  ): Promise<boolean> => {
    const content: SidebarPromptContentBlock[] = [{ type: 'text', text }]
    try {
      const response = await api.prompt({ ...address, content }, signal)
      return response.result.ok
    } catch {
      return false
    }
  }

  return {
    fetchTranscript,
    fetchActivity,
    sendPrompt,
    dispose() {
      disposed = true
      generation++
      seedBoundaryCache.clear()
      transcriptEntryCache.clear()
    },
  }
}
