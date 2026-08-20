/**
 * First increment of the native Sidechain view.
 *
 * This module owns the direct-child catalog and selection shell only. History
 * rows and the continuation composer are intentionally added in later tasks.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { IconRefreshOutline14, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  Context,
  SidebarSessionList,
  SidebarSubagentAddress,
  SidebarSubagentCatalog,
  SidebarSubagentChildEntry,
  SidebarSubagentDiagnosticEntry,
} from '../../context-types.ts'
import type {
  BetterSidebarService,
  SessionScope,
  SidebarStore,
  SidebarTab,
} from '../service.ts'
import { parseSidechainMeta, type SidechainController } from './controller.ts'
import type { SidechainHistory } from './history.ts'
import type { SidechainTranscriptSnapshot } from './history.ts'
import { fileMentionsFor } from './file-mentions.ts'
import { TranscriptRows } from './TranscriptRows.tsx'
import { getSidechainLabels, t } from '../locales.ts'
import css from './SidechainView.module.css'

const ACTIVITY_POLL_MS = 3000
const EMPTY_ENTRIES: readonly CatalogEntry[] = []

export interface SidechainViewProps {
  ctx: Context
  service: BetterSidebarService
  scope: SessionScope
  tab: SidebarTab
  visible: boolean
  controller: SidechainController
  history: SidechainHistory
  /** Kept for the descriptor contract; the list shell does not read it yet. */
  store?: SidebarStore
}

type CatalogEntry = SidebarSubagentChildEntry | SidebarSubagentDiagnosticEntry

interface ActivityState {
  ownerParentSessionId: string | undefined
  lines: Record<string, string>
}

interface TranscriptState {
  owner: string | undefined
  status: 'loading' | 'ready' | 'error'
  snapshot: SidechainTranscriptSnapshot | undefined
}

function selectActivityLine(
  activity: { readonly ownerParentSessionId: string | undefined; readonly lines: Readonly<Record<string, string>> },
  parentSessionId: string,
  childId: string,
): string | undefined {
  return activity.ownerParentSessionId === parentSessionId ? activity.lines[childId] : undefined
}

/** Native Sidechain page list shell. */
export function SidechainView(props: SidechainViewProps) {
  const { ctx, service, scope, tab, visible, controller, history } = props
  const sessions = ctx.sessions
  const labels = getSidechainLabels()
  const list = useSyncExternalStore<SidebarSessionList>(
    useMemo(() => (callback: () => void) => sessions.list.subscribe(callback), [sessions]),
    useCallback(() => sessions.list.getSnapshot(), [sessions]),
  )
  const parentSessionId = scope.sessionId
  const catalog = list.subagentsByParent?.[parentSessionId]
  const entries = catalog?.entries ?? EMPTY_ENTRIES
  const selectedChildId = parseSidechainMeta(tab.meta).selectedChildId
  const liveChildIds = useMemo(
    () => entries.filter((entry): entry is SidebarSubagentChildEntry => entry.kind === 'child').map(entry => entry.id),
    [entries],
  )

  // Catalog observation is deliberately one-parent and visible-gated. The
  // cleanup also runs when scope or tab visibility changes.
  useEffect(() => {
    if (!visible) return
    sessions.setSubagentCatalogOpen?.(parentSessionId, true)
    return () => { sessions.setSubagentCatalogOpen?.(parentSessionId, false) }
  }, [parentSessionId, sessions, visible])

  // Once a ready catalog is available, a persisted ID that is no longer a
  // direct child must return to the list. Loading/error snapshots are left
  // untouched so a transient feed gap cannot erase user selection.
  useEffect(() => {
    if (catalog?.state !== 'ready' || selectedChildId === undefined || liveChildIds.includes(selectedChildId)) return
    controller.clearStaleSelection(parentSessionId, liveChildIds)
  }, [catalog?.state, controller, liveChildIds, parentSessionId, selectedChildId])

  const [activity, setActivity] = useState<ActivityState>({ ownerParentSessionId: undefined, lines: {} })
  const currentParentSessionId = useRef(parentSessionId)
  currentParentSessionId.current = parentSessionId
  const requestEpoch = useRef(0)

  // Activity is addressed by parent + child. Never carry a parent's line into
  // another parent's catalog, even when both catalogs contain the same child ID.
  useEffect(() => {
    setActivity(previous => previous.ownerParentSessionId === parentSessionId && Object.keys(previous.lines).length === 0
      ? previous
      : { ownerParentSessionId: parentSessionId, lines: {} })
  }, [parentSessionId])

  // Activity is a small live hint, not a catalog source. Poll only running
  // rows, and invalidate both the interval and in-flight responses on every
  // lifecycle change.
  useEffect(() => {
    requestEpoch.current++
    const epoch = requestEpoch.current
    if (!visible || catalog?.state !== 'ready') {
      setActivity(previous => previous.ownerParentSessionId === parentSessionId && Object.keys(previous.lines).length === 0
        ? previous
        : { ownerParentSessionId: parentSessionId, lines: {} })
      return
    }
    const running = entries.filter(
      (entry): entry is SidebarSubagentChildEntry => entry.kind === 'child' && entry.activity === 'running',
    )
    const runningIds = new Set(running.map(entry => entry.id))
    setActivity(previous => {
      const previousLines = previous.ownerParentSessionId === parentSessionId ? previous.lines : {}
      const next: Record<string, string> = {}
      for (const [id, line] of Object.entries(previousLines)) {
        if (runningIds.has(id)) next[id] = line
      }
      return previous.ownerParentSessionId === parentSessionId
        && Object.keys(next).length === Object.keys(previousLines).length
        ? previous
        : { ownerParentSessionId: parentSessionId, lines: next }
    })
    if (running.length === 0) {
      return
    }
    const abort = new AbortController()
    let disposed = false
    let inFlight = false
    const poll = async (): Promise<void> => {
      if (disposed || inFlight) return
      inFlight = true
      try {
        await Promise.all(running.map(async entry => {
          const address: SidebarSubagentAddress = {
            parentSessionId, childSessionId: entry.id, mode: entry.mode,
          }
          try {
            const line = await history.fetchActivity(address, abort.signal)
            if (!disposed
              && requestEpoch.current === epoch
              && currentParentSessionId.current === parentSessionId
              && line !== null
              && line.trim() !== '') {
              setActivity(previous => previous.ownerParentSessionId === parentSessionId
                ? {
                    ownerParentSessionId: parentSessionId,
                    lines: { ...previous.lines, [entry.id]: line },
                  }
                : previous)
            }
          } catch {
            // One child's activity failure must not affect sibling rows.
          }
        }))
      } finally {
        inFlight = false
      }
    }
    void poll()
    const timer = globalThis.setInterval(() => { void poll() }, ACTIVITY_POLL_MS)
    return () => {
      disposed = true
      requestEpoch.current++
      abort.abort()
      globalThis.clearInterval(timer)
    }
  }, [catalog?.state, entries, history, parentSessionId, visible])

  const refresh = useCallback(() => {
    void sessions.refreshSubagents?.(parentSessionId)
  }, [parentSessionId, sessions])

  const select = useCallback((childId: string) => {
    controller.selectChild(parentSessionId, childId)
  }, [controller, parentSessionId])

  const back = useCallback(() => {
    controller.selectChild(parentSessionId, undefined)
  }, [controller, parentSessionId])

  const selected = selectedChildId === undefined
    ? undefined
      : entries.find((entry): entry is SidebarSubagentChildEntry => entry.kind === 'child' && entry.id === selectedChildId)

  const selectedKey = selected === undefined ? undefined : `${parentSessionId}:${selected.id}`
  const [transcript, setTranscript] = useState<TranscriptState>({ owner: undefined, status: 'loading', snapshot: undefined })
  const transcriptEpoch = useRef(0)
  const transcriptSelection = useRef<string | undefined>(undefined)
  const transcriptRetry = useRef(0)
  const [transcriptRetryNonce, setTranscriptRetryNonce] = useState(0)

  // A transcript belongs to exactly one selected-child lifecycle. The same
  // epoch guards both timer reads and late promises after selection/hide.
  useEffect(() => {
    const epoch = ++transcriptEpoch.current
    const previousKey = transcriptSelection.current
    const retryChanged = transcriptRetryNonce !== transcriptRetry.current
    transcriptRetry.current = transcriptRetryNonce
    if (!visible || selected === undefined || selectedKey === undefined) return
    transcriptSelection.current = selectedKey

    const address: SidebarSubagentAddress = {
      parentSessionId,
      childSessionId: selected.id,
      mode: selected.mode,
    }
    const abort = new AbortController()
    let disposed = false
    let inFlight = false
    const current = (): boolean => !disposed && transcriptEpoch.current === epoch
    const read = async (): Promise<void> => {
      if (!current() || inFlight) return
      inFlight = true
      try {
        const snapshot = await history.fetchTranscript(address, abort.signal)
        if (current()) setTranscript({ owner: selectedKey, status: 'ready', snapshot })
      } catch {
        if (current()) setTranscript(previous => previous.owner === selectedKey
          ? { owner: selectedKey, status: 'error', snapshot: previous.snapshot }
          : previous)
      } finally {
        inFlight = false
      }
    }

    // Initial inactive children are read once. Running children read now and
    // continue on the local timer; retry always forces one immediate read.
    setTranscript(previous => previous.owner === selectedKey && previous.snapshot !== undefined
      ? previous
      : { owner: selectedKey, status: 'loading', snapshot: undefined })
    if (previousKey !== selectedKey || retryChanged || selected.activity === 'running') void read()
    const timer = selected.activity === 'running'
      ? globalThis.setInterval(() => { void read() }, ACTIVITY_POLL_MS)
      : undefined
    return () => {
      disposed = true
      transcriptEpoch.current++
      abort.abort()
      if (timer !== undefined) globalThis.clearInterval(timer)
    }
  }, [history, parentSessionId, selected?.activity, selected?.id, selected?.mode, selectedKey, transcriptRetryNonce, visible])

  if (selectedChildId !== undefined && selected !== undefined) {
    const selectedTranscript = transcript.owner === selectedKey ? transcript : {
      owner: selectedKey, status: 'loading' as const, snapshot: undefined,
    }
    const snapshot = selectedTranscript.snapshot
    return (
      <div className={css.sidechain} data-sidechain-view>
        <div className={css.sidechainHeader}>
          <button type="button" data-sidechain-back className={css.sidechainBack} onClick={back}>
            {labels.sidechainBack}
          </button>
          <span className={css.sidechainHeaderTitle}>{childLabel(selected, list)}</span>
        </div>
        {selectedTranscript.status === 'loading' && (
          <div className={css.sidechainDetail} data-sidechain-detail aria-busy="true">
            <span className={css.sidechainLoading}>{labels.sidechainLoading}</span>
          </div>
        )}
        {selectedTranscript.status === 'error' && (
          <div className={css.sidechainError} data-sidechain-detail data-sidechain-transcript-error>
            <span>{labels.sidechainError}</span>
            <button type="button" data-sidechain-transcript-retry onClick={() => { setTranscriptRetryNonce(value => value + 1) }}>
              {labels.sidechainRetry}
            </button>
          </div>
        )}
        {selectedTranscript.status === 'ready' && snapshot !== undefined && snapshot.rows.length === 0 && (
          <div className={css.sidechainEmpty} data-sidechain-detail data-sidechain-transcript-empty>
            {labels.sidechainEmpty}
          </div>
        )}
        {selectedTranscript.status === 'ready' && snapshot !== undefined && snapshot.rows.length > 0 && (
          <div className={css.sidechainTranscript} data-sidechain-detail>
            <TranscriptRows
              rows={snapshot.rows}
              streaming={snapshot.streaming}
              labels={labels}
              fileMentions={fileMentionsFor(snapshot.produced, scope.cwd, path => { service.openFile(scope, path) })}
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={css.sidechain} data-sidechain-view>
      <div className={css.sidechainHeader}>
        <span className={css.sidechainTitle}>{labels.sidechain}</span>
        <button
          type="button"
          data-sidechain-refresh
          className={css.sidechainRefresh}
          aria-label={t('refresh')}
          title={t('refresh')}
          onClick={refresh}
        >
          <IconRefreshOutline14 />
        </button>
      </div>
      <div className={css.sidechainBody}>
        {catalog === undefined || catalog.state === 'loading' ? (
          <div className={css.sidechainEmpty} data-sidechain-loading>{labels.sidechainLoading}</div>
        ) : catalog.state === 'error' ? (
          <div className={css.sidechainError} data-sidechain-error>
            <span>{labels.sidechainError}</span>
            {catalog.error?.message !== undefined && <span className={css.sidechainErrorDetail}>{catalog.error.message}</span>}
            <button type="button" onClick={refresh}>{labels.sidechainRetry}</button>
          </div>
        ) : entries.length === 0 ? (
          <div className={css.sidechainEmpty} data-sidechain-empty>{labels.sidechainEmpty}</div>
        ) : (
          entries.map(entry => entry.kind === 'child'
            ? <ChildRow
                key={entry.id}
                entry={entry}
                list={list}
                activity={selectActivityLine(activity, parentSessionId, entry.id)}
                onSelect={select}
              />
            : <DiagnosticRow key={entry.id} entry={entry} labels={labels} />)
        )}
      </div>
    </div>
  )
}

function childLabel(entry: SidebarSubagentChildEntry, list: SidebarSessionList): string {
  return entry.label ?? list.byId[entry.id]?.displayTitle ?? entry.id
}

function ChildRow(props: {
  entry: SidebarSubagentChildEntry
  list: SidebarSessionList
  activity?: string
  onSelect: (id: string) => void
}) {
  const { entry, list, activity, onSelect } = props
  const labels = getSidechainLabels()
  const running = entry.activity === 'running'
  return (
    <button
      type="button"
      className={css.sidechainRow}
      data-sidechain-row={entry.id}
      onClick={() => { onSelect(entry.id) }}
      aria-label={childLabel(entry, list)}
    >
      <StateDot state={running ? 'ongoing' : 'done'} className={css.sidechainDot} />
      <span className={css.sidechainRowContent}>
        <span className={css.sidechainRowLabel}>{childLabel(entry, list)}</span>
        <span className={css.sidechainRowSecondary}>
          {entry.mode === 'one-shot' ? labels.sidechainOneShot : labels.sidechainContinuable}
          {' · '}
          {running ? labels.sidechainRunning : labels.sidechainInactive}
          {activity !== undefined && <span className={css.sidechainActivity}> · {activity}</span>}
        </span>
      </span>
    </button>
  )
}

function DiagnosticRow(props: { entry: SidebarSubagentDiagnosticEntry; labels: ReturnType<typeof getSidechainLabels> }) {
  const { entry, labels } = props
  const reason = entry.reason === 'corrupt'
    ? labels.sidechainDiagnosticCorrupt
    : entry.reason === 'unsupported'
      ? labels.sidechainDiagnosticUnsupported
      : labels.sidechainDiagnosticUnavailable
  return <div className={css.sidechainDiagnostic} data-sidechain-diagnostic={entry.id}>{entry.id} · {reason}</div>
}
