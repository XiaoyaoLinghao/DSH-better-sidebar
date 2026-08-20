/**
 * Portions of this file are adapted from @dsh-external/dsh-sidechain,
 * Copyright (c) 2026, dsh-external contributors, under the BSD-3-Clause
 * License. See THIRD_PARTY_NOTICES for the complete notice.
 *
 * Native better-sidebar presentation of the durable sidechain transcript.
 */

import { useMemo, useState } from 'react'
import {
  DisclosureRow,
  IconBrowseOutline16,
  IconThinkOutline14,
  MarkdownText,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  MarkdownCodeLabels,
  MarkdownFileMentions,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { SidechainLabels } from '../locales.ts'
import type { ToolDetail, TranscriptRow } from './transcript.ts'
import { blockText } from './transcript.ts'
import styles from './SidechainView.module.css'

export interface TranscriptRowsProps {
  rows: readonly TranscriptRow[]
  streaming: boolean
  fileMentions?: MarkdownFileMentions | undefined
  labels: SidechainLabels
}

type AnyRecord = Record<string, unknown>

function record(value: unknown): AnyRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as AnyRecord
    : undefined
}

const TOOL_ARGUMENTS_MAX = 2000

function prettyInput(detail: ToolDetail, callView: AnyRecord | undefined): string | undefined {
  const curated = callView?.rawInput
  if (curated !== undefined) {
    try {
      return JSON.stringify(curated, null, 2)
    } catch {
      // Fall through to the bounded raw argument representation.
    }
  }
  if (detail.arguments === undefined) return undefined
  const bounded = detail.arguments.slice(0, TOOL_ARGUMENTS_MAX)
  try {
    const pretty = JSON.stringify(JSON.parse(bounded), null, 2)
    return pretty.length > TOOL_ARGUMENTS_MAX ? pretty.slice(0, TOOL_ARGUMENTS_MAX) : pretty
  } catch {
    return bounded
  }
}

/** Keep result presentation compact while preserving the host-provided view. */
function resultText(view: unknown): string | undefined {
  const result = record(view)
  if (result === undefined) return undefined
  if (result.card === 'generic' && Array.isArray(result.content)) {
    return blockText(result.content as ContentBlock[])
  }
  if (result.card === 'diff' && Array.isArray(result.diffs)) {
    return result.diffs
      .map(item => record(item)?.path)
      .filter((path): path is string => typeof path === 'string')
      .join(', ')
  }
  if (result.card === 'read' && typeof result.path === 'string') return result.path
  if (result.card === 'search') {
    if (result.shape === 'paths' && Array.isArray(result.paths)) return result.paths.join(', ')
    if (Array.isArray(result.files)) return result.files.length.toString()
  }
  if (result.card === 'web' && typeof result.url === 'string') return result.url
  return undefined
}

function createCodeLabels(labels: SidechainLabels): MarkdownCodeLabels {
  return { copyLabel: labels.copy, copiedLabel: labels.copied }
}

function MarkdownRow({
  text,
  streaming,
  fileMentions,
  codeLabels,
}: {
  text: string
  streaming: boolean
  fileMentions: MarkdownFileMentions | undefined
  codeLabels: MarkdownCodeLabels
}): JSX.Element {
  return (
    <MarkdownText
      text={text}
      streaming={streaming}
      codeLabels={codeLabels}
      fileMentions={fileMentions}
    />
  )
}

function DisclosureTranscriptRow({
  row,
  rowStreaming,
  labels,
}: {
  row: Extract<TranscriptRow, { kind: 'reasoning' | 'context' }>
  rowStreaming: boolean
  labels: SidechainLabels
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const summary = row.text.trim().split('\n').find(line => line !== '') ?? ''
  const title = row.kind === 'reasoning'
    ? labels.sidechainReasoning
    : row.recall ? labels.sidechainRecall : labels.sidechainContext
  const source = row.kind === 'context' ? row.source : null
  return (
    <div className={styles.disclosure} data-transcript-kind={row.kind}>
      <DisclosureRow
        icon={row.kind === 'reasoning' ? <IconThinkOutline14 /> : <IconBrowseOutline16 size={14} />}
        title={title}
        open={open}
        expandable
        expandOnRowClick
        onToggle={() => { setOpen(value => !value) }}
        collapsedContent={(
          <>
            <span className={styles.separator} aria-hidden="true" />
            <span className={styles.summary}>{source ?? (rowStreaming ? summary.slice(-120) : summary)}</span>
          </>
        )}
      >
        <pre className={styles.disclosureBody}>{row.text}</pre>
      </DisclosureRow>
    </div>
  )
}

function ToolTranscriptRow({
  row,
  rowStreaming,
  fileMentions,
  labels,
  codeLabels,
}: {
  row: Extract<TranscriptRow, { kind: 'tool' }>
  rowStreaming: boolean
  fileMentions: MarkdownFileMentions | undefined
  labels: SidechainLabels
  codeLabels: MarkdownCodeLabels
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const detail = row.detail
  const callView = record(detail?.callView)
  const resultView = record(detail?.resultView)
  const terminal = callView?.card === 'terminal' || resultView?.card === 'terminal'
  const input = detail === undefined ? undefined : prettyInput(detail, callView)
  const output = resultText(detail?.resultView)
  const expandable = detail !== undefined && (
    terminal || input !== undefined || output !== undefined || detail.error !== undefined
  )
  const title = typeof callView?.title === 'string' ? callView.title : row.name
  const terminalOutput = resultView?.card === 'terminal' && typeof resultView.output === 'string'
    ? resultView.output
    : undefined
  return (
    <div className={styles.tool} data-transcript-kind="tool" aria-label={labels.sidechainToolDetails}>
      <DisclosureRow
        icon={<StateDot state={row.failed ? 'error' : rowStreaming && detail?.resultView === undefined ? 'ongoing' : 'done'} />}
        title={labels.sidechainToolDetails}
        open={open}
        expandable={expandable}
        expandOnRowClick={expandable}
        onToggle={() => { setOpen(value => !value) }}
        collapsedContent={(
          <>
            <span className={styles.summary}>{title}</span>
            {row.failed && <span className={styles.toolFailure}> {labels.sidechainToolFailed}</span>}
          </>
        )}
      >
        <div className={styles.toolBody}>
          {terminal && (
            <pre className={styles.toolOutput}>
              {typeof callView?.title === 'string' ? `${callView.title}\n` : ''}
              {terminalOutput ?? ''}
            </pre>
          )}
          {!terminal && input !== undefined && <pre className={styles.toolInput}>{input}</pre>}
          {!terminal && output !== undefined && (
            <div className={styles.toolOutput}>
              <MarkdownText
                text={output}
                streaming={false}
                codeLabels={codeLabels}
                fileMentions={fileMentions}
              />
            </div>
          )}
          {detail?.error !== undefined && (
            <div className={styles.toolFailure}>
              {labels.sidechainToolFailed}: {detail.error.name}: {detail.error.code}
            </div>
          )}
        </div>
      </DisclosureRow>
    </div>
  )
}

function TranscriptRowView({
  row,
  rowStreaming,
  fileMentions,
  labels,
  codeLabels,
}: {
  row: TranscriptRow
  rowStreaming: boolean
  fileMentions: MarkdownFileMentions | undefined
  labels: SidechainLabels
  codeLabels: MarkdownCodeLabels
}): JSX.Element {
  if (row.kind === 'reasoning' || row.kind === 'context') {
    return <DisclosureTranscriptRow row={row} rowStreaming={rowStreaming} labels={labels} />
  }
  if (row.kind === 'tool') {
    return <ToolTranscriptRow row={row} rowStreaming={rowStreaming} fileMentions={fileMentions} labels={labels} codeLabels={codeLabels} />
  }
  const assistant = row.kind === 'assistant'
  return (
    <div
      className={`${styles.row} ${assistant ? styles.assistant : styles.user} ${rowStreaming ? styles.streaming : ''}`}
      data-transcript-kind={row.kind}
      data-streaming={rowStreaming ? 'true' : 'false'}
    >
      <MarkdownRow
        text={row.text}
        streaming={rowStreaming}
        fileMentions={fileMentions}
        codeLabels={codeLabels}
      />
      {rowStreaming && <span className={styles.streamingMarker} data-streaming-marker aria-hidden="true" />}
    </div>
  )
}

export function TranscriptRows({ rows, streaming, fileMentions, labels }: TranscriptRowsProps): JSX.Element {
  const codeLabels = useMemo<MarkdownCodeLabels>(
    () => createCodeLabels(labels),
    [labels.copy, labels.copied],
  )
  const localizedFileMentions = useMemo<MarkdownFileMentions | undefined>(() => {
    if (fileMentions === undefined) return undefined
    return {
      resolve(value) {
        const mention = fileMentions.resolve(value)
        if (mention === undefined) return undefined
        return {
          ...mention,
          label: `${labels.sidechainOpenFile}: ${mention.label || value}`,
        }
      },
    }
  }, [fileMentions, labels.sidechainOpenFile])
  return (
    <div className={styles.transcript} data-transcript-rows role="list">
      {rows.map((row, index) => (
        <div role="listitem" key={`${row.kind}:${row.seq}:${index}`}>
          <TranscriptRowView
            row={row}
            rowStreaming={streaming && index === rows.length - 1}
            fileMentions={localizedFileMentions}
            labels={labels}
            codeLabels={codeLabels}
          />
        </div>
      ))}
    </div>
  )
}
