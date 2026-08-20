import type { Context } from '../../context-types.ts'
import type { SidebarStore } from '../state.ts'
import type { BetterSidebarService } from '../service.ts'
import { createSidechainCommandCards } from './SideCommandCard.tsx'
import { createSidechainController, type SidechainController } from './controller.ts'
import { createSidechainHistory, type SidechainHistory } from './history.ts'
import type { SidechainTabOptions } from './register.tsx'

/** The activation-scoped resources shared by the Sidechain tab and cards. */
export interface SidechainClientRuntime {
  tab: SidechainTabOptions
  controller: SidechainController
  history: SidechainHistory
  dispose(): void
}

/**
 * Create the client-side Sidechain resources for one plugin activation.
 *
 * The tab descriptor is deliberately not registered here: builtins owns that
 * registry entry so its disposer has the same lifecycle as every other
 * built-in descriptor. Command cards use declaration-aware slot injection so
 * a late conversation mount cannot race the keyed child slot declaration.
 */
export function createSidechainClientRuntime(
  ctx: Context,
  service: BetterSidebarService,
  store: SidebarStore,
): SidechainClientRuntime {
  const controller = createSidechainController(service, store)
  const history = createSidechainHistory(ctx.connection.api.subagents)
  const slotDisposers: Array<() => void> = []
  let disposed = false

  try {
    for (const card of createSidechainCommandCards()) {
      slotDisposers.push(ctx.slots.inject(
        'conversation.chat.commandview',
        () => ctx.slots.register({
          name: 'conversation.chat.commandview',
          key: card.key,
          registrant: 'dsh-better-sidebar',
        }, card.component),
      ))
    }
  } catch (error) {
    for (const dispose of slotDisposers) {
      try { dispose() } catch { /* best effort during failed activation */ }
    }
    history.dispose()
    controller.dispose()
    throw error
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    for (const disposeSlot of slotDisposers) {
      try { disposeSlot() } catch { /* already disposed */ }
    }
    history.dispose()
    controller.dispose()
  }

  return { tab: { controller, history }, controller, history, dispose }
}
