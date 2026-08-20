#!/usr/bin/env bash
# Consumer-facing type surface check: build a tiny standalone consumer that
# imports `dsh-better-sidebar/client/service` WITHOUT @types/node and with
# skipLibCheck: false, then type-check it with the repo's tsc.
#
# This is the exact scenario the v0.12.0 API work cares about: the shipped
# declaration graph (service.d.ts -> context-types.d.ts -> state/api) must
# resolve and type-check for a browser-only plugin author. Run AFTER
# `pnpm build` (the check reads lib/types).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
cd "$ROOT"

SAFE_TEMP="$SCRIPT_DIR/safe-temp.mjs"
command -v node >/dev/null 2>&1 || {
  echo "[check-consumer-types] FAIL: node is required for portable scratch/link handling." >&2
  exit 1
}
TEMP_BASE="$(node -p "require('node:os').tmpdir()")"

# The check reads the BUILT declaration surface (lib/types) — fail loudly
# instead of silently passing when the build output is missing.
if [ ! -f lib/types/client/service.d.ts ]; then
  echo "[check-consumer-types] FAIL: lib/types/client/service.d.ts not found — run 'pnpm build' first." >&2
  exit 1
fi

WORK_INFO="$(node "$SAFE_TEMP" create "$TEMP_BASE" "$ROOT" 'dsh-consumer-types.')"
WORK="$(node -p "JSON.parse(process.argv[1]).scratch" "$WORK_INFO")"
WORK_TOKEN="$(node -p "JSON.parse(process.argv[1]).token" "$WORK_INFO")"
cleanup() {
  local code=$?
  local quarantine_result
  if quarantine_result="$(node "$SAFE_TEMP" remove "$WORK" "$TEMP_BASE" "$ROOT" 'dsh-consumer-types.' "$WORK_TOKEN" 2>&1)"; then
    if quarantine_path="$(node -p "JSON.parse(process.argv[1]).quarantine" "$quarantine_result" 2>/dev/null)"; then
      echo "[check-consumer-types] scratch quarantined (not deleted); reclaim manually: $quarantine_path" >&2
    else
      echo "[check-consumer-types] WARNING: cleanup returned an unparseable result; preserving: $quarantine_result" >&2
    fi
  else
    echo "[check-consumer-types] WARNING: scratch quarantine refused; preserving $WORK: $quarantine_result" >&2
  fi
  exit "$code"
}
trap cleanup EXIT

mkdir -p "$WORK/node_modules"
node "$SAFE_TEMP" link "$ROOT" "$WORK/node_modules/dsh-better-sidebar" "$WORK" "$TEMP_BASE" "$ROOT" 'dsh-consumer-types.' "$WORK_TOKEN"

cat > "$WORK/check.ts" <<'EOF'
import { SIDEBAR_FEATURES, SIDEBAR_SERVICE_VERSION } from 'dsh-better-sidebar/client/service'
import type {} from 'dsh-better-sidebar/client/service'
import type {
  BetterSidebarService, FileViewerDescriptor, OpenTabSeed, SidebarSettingsRenderProps,
  TabComponentProps, TabDescriptor,
} from 'dsh-better-sidebar/client/service'
import type { SessionScope, SidebarSnapshot, SidebarState, SidebarStore, SidebarTab } from 'dsh-better-sidebar/client/service'
import type { SidebarPrefs } from 'dsh-better-sidebar/client/service'

declare const ctx: { betterSidebar: BetterSidebarService }
const tab: TabDescriptor = {
  id: 'x:tab',
  title: 'X',
  single: true,
  badge: (_ctx, _scope, state: SidebarState) => state.expanded.length,
  onOpen: (_tab: SidebarTab, _scope: SessionScope) => {},
  onClose: (_tab: SidebarTab, _scope: SessionScope) => {},
  createTab: (state: SidebarState) => ({ tab: { id: 'x:1', type: 'x:tab', title: 'X', meta: {} } }),
  settings: {
    toggles: [{ key: 'autoOpenSubagent', title: 'A' }],
    pluginToggles: [{ key: 'k', title: 'K', type: 'number', min: 0, max: 9 }],
    render: (props: SidebarSettingsRenderProps) => { props.updatePluginSetting('a', 1); return null },
  },
  component: (props: TabComponentProps) => null,
}
ctx.betterSidebar.registerTab(tab)
const viewer: FileViewerDescriptor = {
  id: 'x:csv', exts: ['csv'], fetchStrategy: 'custom',
  load: (_path, _scope, signal?: AbortSignal) => { void signal; return Promise.resolve([]) },
  component: () => null,
}
ctx.betterSidebar.registerFileViewer(viewer)
const seed: OpenTabSeed = { type: 'x:tab', title: 'X', meta: { a: 1 } }
ctx.betterSidebar.openTab(seed, { sessionId: 's1' })
ctx.betterSidebar.openFile({ sessionId: 's1' }, '/p/a.csv')
ctx.betterSidebar.updateTab('t', { meta: { b: 2 } })
const snap: SidebarSnapshot = ctx.betterSidebar.getSnapshot()
const prefs: SidebarPrefs = snap.prefs
const store: SidebarStore = null as unknown as SidebarStore
void prefs; void store; void ctx.betterSidebar.version; void ctx.betterSidebar.features
void SIDEBAR_SERVICE_VERSION; void SIDEBAR_FEATURES
EOF

cat > "$WORK/tsconfig.json" <<'EOF'
{
  "compilerOptions": {
    "target": "ES2023", "module": "esnext", "moduleResolution": "bundler",
    "strict": true, "noEmit": true, "skipLibCheck": false, "types": [],
    "jsx": "react-jsx", "lib": ["ES2023", "DOM"]
  },
  "include": ["check.ts"]
}
EOF

echo "[check-consumer-types] type-checking a browser-only consumer (no @types/node)..."
echo "[check-consumer-types]   pass 1: skipLibCheck: true (the realistic consumer experience) — must be fully clean"
./node_modules/.bin/tsc -p "$WORK/tsconfig.json" --skipLibCheck true
echo "[check-consumer-types]   pass 2: skipLibCheck: false — OUR declaration surface (lib/types/**) must be clean"
echo "[check-consumer-types]   (upstream cordis/cosmokit declaration noise is filtered out; it predates this plugin)"
set +e
./node_modules/.bin/tsc -p "$WORK/tsconfig.json" --skipLibCheck false > "$WORK/strict.log" 2>&1
STATUS=$?
set -e
# Fail only on errors that mention OUR package / declarations / the fixture.
if grep -E "dsh-better-sidebar|lib/types|check\.ts" "$WORK/strict.log" | grep -v "node_modules/cordis\|node_modules/cosmokit"; then
  echo "[check-consumer-types] FAIL: errors in the dsh-better-sidebar declaration surface:" >&2
  grep -E "dsh-better-sidebar|lib/types|check\.ts" "$WORK/strict.log" >&2
  exit 1
fi
if [ "$STATUS" -ne 0 ]; then
  echo "[check-consumer-types] pass 2 note: strict mode only reports upstream declaration noise:"
  grep -v "dsh-better-sidebar\|lib/types\|check\.ts" "$WORK/strict.log" | head -5
fi
echo "[check-consumer-types] OK: the client/service declaration surface is node-free and self-contained."

