import { IconThinkOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context } from '../../context-types.ts'
import { t } from '../locales.ts'
import type { SidebarState, TabDescriptor, TabComponentProps } from '../service.ts'
import { SidechainView, type SidechainViewProps } from './SidechainView.tsx'
import type { SidechainController } from './controller.ts'
import type { SidechainHistory } from './history.ts'

/** Shared activation-scoped dependencies used by the Sidechain tab. */
export interface SidechainTabOptions {
  controller: SidechainController
  history: SidechainHistory
}

/** Build the Sidechain tab descriptor; registration remains owned by builtins. */
export function createSidechainTab(options: SidechainTabOptions): TabDescriptor {
  return {
    id: 'sidechain',
    title: () => t('sidechain'),
    icon: (size: number) => <IconThinkOutline16 size={size} />,
    order: 35,
    single: true,
    settings: {
      toggles: [{
        key: 'autoOpenSidechain',
        title: () => t('autoOpenSidechain'),
        desc: () => t('autoOpenSidechainDesc'),
      }],
    },
    badge: (ctx: Context, scope, _state: SidebarState) => {
      const catalog = ctx.sessions.list.getSnapshot().subagentsByParent?.[scope.sessionId]
      if (catalog?.state !== 'ready') return 0
      return catalog?.entries.filter(entry => entry.kind === 'child' && entry.activity === 'running').length ?? 0
    },
    component: (props: TabComponentProps) => {
      const viewProps = {
        ...props,
        service: props.ctx.betterSidebar,
        controller: options.controller,
        history: options.history,
      } as SidechainViewProps & TabComponentProps
      return <SidechainView {...viewProps} />
    },
  }
}
