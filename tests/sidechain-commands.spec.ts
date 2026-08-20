import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  CommandDefinition,
  CommandId,
  CommandInvocation,
} from '@deepseek-ai/dsh-commands'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  ContinuableStart,
  SubagentListEntry,
  SubagentRun,
} from '@deepseek-ai/dsh-subagent'
import { describe, expect, it, vi } from 'vitest'
import { createSidechainCommands } from '../src/sidechain-host/commands.ts'
import { SIDE_PERSONA } from '../src/sidechain-host/prompts.ts'
import type { SideDeps, SubagentsLike } from '../src/sidechain-host/side.ts'

const PARENT_ID = 'parent-1' as SessionId
const CHILD_ID = 'child-9' as SessionId
const agent = { session: { id: PARENT_ID } } as unknown as Agent
const signal = new AbortController().signal
const deps: SideDeps = { providerName: 'fork', persona: SIDE_PERSONA }

interface Harness {
  subagents: SubagentsLike & {
    start: ReturnType<typeof vi.fn>
    startContinuable: ReturnType<typeof vi.fn>
    listChildren: ReturnType<typeof vi.fn>
    getProvider: ReturnType<typeof vi.fn>
  }
  commands: CommandDefinition[]
  noteChild: ReturnType<typeof vi.fn>
}

function makeHarness(): Harness {
  const subagents = {
    start: vi.fn(),
    startContinuable: vi.fn(),
    listChildren: vi.fn(),
    getProvider: vi.fn(() => ({ name: 'fork' })),
  } as unknown as Harness['subagents']
  const noteChild = vi.fn()
  return {
    subagents,
    commands: createSidechainCommands(subagents, deps, { noteChild }),
    noteChild,
  }
}

function invoke(command: CommandDefinition, rawInput: string, invocationSignal = signal) {
  const invocation: CommandInvocation = {
    commandId: 'cmd' as CommandId,
    agent,
    rawInput,
    signal: invocationSignal,
    attachments: [],
  }
  return command.handler(invocation)
}

function runOf(result: Promise<unknown> = new Promise<never>(() => {})): SubagentRun {
  return {
    id: CHILD_ID,
    result,
    dispose: vi.fn().mockResolvedValue(undefined),
  } as unknown as SubagentRun
}

function childEntry(): SubagentListEntry {
  return {
    kind: 'child',
    id: CHILD_ID,
    activity: 'running',
    hasChildren: false,
    mode: 'continuable',
    label: 'Inspect events',
  }
}

describe('sidechain command definitions', () => {
  it('registers /side and /btw with rc.8 input metadata', () => {
    const { commands } = makeHarness()
    expect(commands.map(command => command.name)).toEqual(['side', 'btw'])
    expect(commands.map(command => command.input)).toEqual([
      { hint: '<question>' },
      { hint: '<question>' },
    ])
    expect(commands.every(command => command.recordInput === false)).toBe(true)
  })

  it('rejects empty /side and /btw questions without starting a child', async () => {
    const { subagents, commands } = makeHarness()
    await expect(invoke(commands[0]!, '   ')).resolves.toEqual({
      kind: 'error',
      text: '/side requires a question: /side <question>',
    })
    await expect(invoke(commands[1]!, '\t')).resolves.toEqual({
      kind: 'error',
      text: '/btw requires a question: /btw <question>',
    })
    expect(subagents.start).not.toHaveBeenCalled()
    expect(subagents.startContinuable).not.toHaveBeenCalled()
  })

  it('lists direct children for both list and ls aliases', async () => {
    const { subagents, commands } = makeHarness()
    subagents.listChildren.mockResolvedValue([childEntry()])

    await expect(invoke(commands[0]!, 'list')).resolves.toEqual({
      kind: 'success',
      text: '- [side/running] Inspect events — child-9',
    })
    await expect(invoke(commands[0]!, 'ls')).resolves.toEqual({
      kind: 'success',
      text: '- [side/running] Inspect events — child-9',
    })
    expect(subagents.listChildren).toHaveBeenNthCalledWith(1, PARENT_ID, signal)
  })

  it('returns a provider-missing error before starting either command', async () => {
    const { subagents, commands } = makeHarness()
    subagents.getProvider.mockReturnValue(undefined)

    await expect(invoke(commands[0]!, 'question')).resolves.toMatchObject({
      kind: 'error',
    })
    await expect(invoke(commands[1]!, 'question')).resolves.toMatchObject({
      kind: 'error',
    })
    expect(subagents.start).not.toHaveBeenCalled()
    expect(subagents.startContinuable).not.toHaveBeenCalled()
  })

  it('starts /side, registers settlement silence, and returns its exact marker', async () => {
    const { subagents, commands, noteChild } = makeHarness()
    subagents.startContinuable.mockResolvedValue({ childId: CHILD_ID } as ContinuableStart)

    await expect(invoke(commands[0]!, '  inspect this  ')).resolves.toEqual({
      kind: 'success',
      text: `Side conversation started: ${CHILD_ID}.`,
    })
    expect(noteChild).toHaveBeenCalledWith(CHILD_ID)
  })

  it('starts /btw without waiting for its child result', async () => {
    const { subagents, commands, noteChild } = makeHarness()
    const run = runOf()
    subagents.start.mockResolvedValue(run)

    await expect(invoke(commands[1]!, 'question')).resolves.toEqual({
      kind: 'success',
      text: `BTW question started: ${CHILD_ID}.`,
    })
    expect(noteChild).toHaveBeenCalledWith(CHILD_ID)
    expect(run.dispose).not.toHaveBeenCalled()
  })

  it('disposes a one-shot run only after its result settles', async () => {
    const { subagents, commands } = makeHarness()
    let settle!: (value: unknown) => void
    const result = new Promise(resolve => { settle = resolve })
    const run = runOf(result)
    subagents.start.mockResolvedValue(run)

    await invoke(commands[1]!, 'question')
    expect(run.dispose).not.toHaveBeenCalled()
    settle({ ok: true })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(run.dispose).toHaveBeenCalledTimes(1)
  })

  it('disposes a one-shot run when its result rejects', async () => {
    const { subagents, commands } = makeHarness()
    const run = runOf(Promise.reject(new Error('child failed')))
    subagents.start.mockResolvedValue(run)

    await expect(invoke(commands[1]!, 'question')).resolves.toMatchObject({ kind: 'success' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(run.dispose).toHaveBeenCalledTimes(1)
  })
})
