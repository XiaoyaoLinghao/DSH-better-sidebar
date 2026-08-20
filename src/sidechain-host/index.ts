/**
 * Host-side activation for the native `/side` and `/btw` commands.
 *
 * The feature deliberately lives behind nested Cordis injections.  The
 * sidebar routes are useful without the optional agent/subagent/command
 * services, so their absence must only disable this feature rather than make
 * the host plugin fiber inactive.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '../context-types.ts'
import type { ResolvedSidebarConfig } from '../config.ts'
import { createSidechainCommands } from './commands.ts'
import { createSettlementSilence } from './settlement-silence.ts'
import type { SideDeps, SubagentsLike } from './side.ts'

interface SettlementSilence {
  noteChild(childId: string): void
  dispose(): void
}

interface CommandsLike {
  register(definition: unknown): () => void
}

type SidechainContext = Context & {
  agents: Context['agents'] & {
    list(): unknown[]
  }
  subagents: SubagentsLike
  commands: CommandsLike
}

/** Resolve the durable settlement registry location used by the host. */
export function sidechainRegistryPath(): string {
  const configured = process.env.DSH_HOME
  const home = configured !== undefined && configured.trim() !== ''
    ? configured
    : join(homedir(), '.dsh')
  return join(home, 'sidechain-children.json')
}

/**
 * Activate native sidechain support when its optional host services exist.
 * All registrations and isolation wrappers are owned by nested Cordis
 * fibers/effects and therefore unwind automatically with the services.
 */
export function registerSidechainHost(
  ctx: Context,
  config: ResolvedSidebarConfig['sidechain'],
): void {
  ctx.inject(['agents', 'subagents'], (rawSideCtx) => {
    const sideCtx = rawSideCtx as unknown as SidechainContext
    const settlement: SettlementSilence = createSettlementSilence(sideCtx, {
      registryPath: sidechainRegistryPath(),
    })

    // Keep admission wrappers alive exactly as long as the injected
    // agents/subagents fiber.  The returned disposer is intentionally passed
    // through Cordis rather than being called by this function.
    sideCtx.effect(() => () => settlement.dispose(), 'dsh-better-sidebar: sidechain settlement silence')

    const deps: SideDeps = {
      providerName: config.providerName,
      persona: config.persona,
      ...(config.readOnlyTools === undefined
        ? {}
        : { toolFilter: { allow: config.readOnlyTools } }),
    }

    // Commands are optional even when the subagent services are present.  A
    // deployment without dsh-commands still gets settlement isolation and all
    // regular sidebar routes.
    sideCtx.inject(['commands'], (rawCommandCtx) => {
      const commandCtx = rawCommandCtx as unknown as SidechainContext
      const definitions = createSidechainCommands(sideCtx.subagents, deps, settlement)
      for (const definition of definitions) {
        commandCtx.effect(
          () => commandCtx.commands.register(definition),
          `dsh-better-sidebar: /${definition.name} command`,
        )
      }
    })
  })
}
