/**
 * Built-in registration: the plugin registers its own tab pages and file
 * previewers through the same {@link BetterSidebarService} external plugins
 * use — eating its own dogfood. The descriptors live next to their feature
 * modules (tabs.tsx / viewers.tsx); this module only aggregates them and
 * owns the disposer lifecycle (cordis auto-invokes it on fiber disposal,
 * HMR-safe).
 */
import type { Context } from '../../context-types.ts'
import type { BetterSidebarService } from '../service.ts'
import { builtinTabs, type BuiltinTabOptions } from './tabs.tsx'
import { builtinViewers } from './viewers.tsx'
import { createSidechainTab } from '../sidechain/register.tsx'

/**
 * Register all built-in tabs and viewers with the service. Returns a
 * disposer that unregisters everything (cordis auto-invokes it on fiber
 * disposal). The `ctx` is threaded into tab descriptors that need it
 * (EditorHost reads `ctx.betterSidebar` for file-viewer matching).
 */
export function registerBuiltins(
  ctx: Context,
  service: BetterSidebarService,
  options: BuiltinTabOptions = {},
): () => void {
  const disposers: (() => void)[] = []
  let disposed = false
  const disposeAll = (): void => {
    if (disposed) return
    disposed = true
    for (let index = disposers.length - 1; index >= 0; index--) {
      try { disposers[index]!() } catch { /* already disposed */ }
    }
  }
  try {
    for (const tab of builtinTabs(ctx, options)) {
      disposers.push(service.registerTab(tab))
    }
    if (options.sidechain !== undefined) {
      disposers.push(service.registerTab(createSidechainTab(options.sidechain)))
    }
    for (const viewer of builtinViewers()) {
      disposers.push(service.registerFileViewer(viewer))
    }
    return disposeAll
  } catch (error) {
    disposeAll()
    throw error
  }
}
