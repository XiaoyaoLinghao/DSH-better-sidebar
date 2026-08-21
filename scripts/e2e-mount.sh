#!/usr/bin/env bash
# =============================================================================
# dsh-better-sidebar 挂载冒烟编排（CI + 本地）：
#
#   1. 用官方 CLI 把 npm 打包产物（tarball）真实挂载进一个全新 scratch
#      profile（`dsh plugin --profile web add file:<tarball>`，触发
#      dsh.profile.bundles 协调，与用户安装路径一致）；
#   2. 启动真实 `dsh web`（keyless，--port 0 取 OS 分配端口）；
#   3. 运行 tests/e2e 无头渲染 lane（Playwright Chromium）：断言外壳与
#      插件挂载、无崩溃标记，并驱动内置 tab 深扫。
#
# 用法：
#   bash scripts/e2e-mount.sh [--grep <playwright-filter>]
#
# 环境变量（均可省略）：
#   DSH_CMD        可选的 dsh 命令覆盖；为空时固定使用 pnpm dlx 拉 rc8
#   --probe-default-cli 仅供回归测试：解析默认 CLI 后执行 --version 并退出
#   --probe-e2e-mode 仅供回归测试：在不创建 scratch/启动 DSH 的情况下，
#                    通过 Playwright 命令边界捕获 onboarding 模式并退出
#   TARBALL        插件 tarball；未显式提供时自动 build + pack 到 scratch
#   PORT           固定端口（默认 0 = OS 分配，从日志解析 URL）
#   DSH_HOME_BASE  覆盖 scratch 根目录（默认系统临时目录）。脚本始终在其下
#                  新建本调用拥有的独立子目录，只写入并在结束时隔离该子目录；调用方
#                  提供的目录本身（可能是真实 ~/.dsh）绝不写入或删除。隔离目录需手动回收。
#   KEEP_HOME      非空时保留 scratch home（调试用）
#
# 退出码 = playwright 的退出码；服务器与 scratch 隔离由 trap 兜底处理。
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
cd "$ROOT"
SAFE_TEMP="$SCRIPT_DIR/safe-temp.mjs"

DSH_CMD="${DSH_CMD-}"
PORT="${PORT:-0}"
TARBALL="${TARBALL:-}"
GREP_FILTER=""
if [ "${1:-}" = "--grep" ]; then GREP_FILTER="${2:?--grep 需要参数}"; fi

say()  { printf '\033[32m[e2e-mount]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[e2e-mount]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m[e2e-mount]\033[0m %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "未找到 node（DSH 运行需要 Node.js >= 20）"
command -v pnpm >/dev/null 2>&1 || die "未找到 pnpm（dsh plugin 转发给 pnpm）"

# dsh CLI 解析：默认永远固定到 rc8；显式覆盖必须可解析，不能静默回退。
if [ -n "$DSH_CMD" ]; then
  command -v "$DSH_CMD" >/dev/null 2>&1 || die "DSH_CMD 无效：$DSH_CMD（不会回退到其他命令）"
  DSH_MODE=path
else
  DSH_MODE=pnpm
fi

# The default pinned rc.8 lane is keyless by construction and must prove that
# its provider/onboarding takeover is dismissible after every navigation. An
# explicit DSH_CMD is an opt-in compatibility/debug lane: it keeps the short,
# optional onboarding path. Set this value from the resolved runner mode only;
# never inherit a similarly named caller variable into the Playwright process.
if [ "$DSH_MODE" = pnpm ]; then
  E2E_ONBOARDING_EXPECTED=1
else
  E2E_ONBOARDING_EXPECTED=0
fi

# Keep the exact package pin and native build allow-list in shared variables;
# both plugin mounting and web launch must use the same pnpm dlx contract.
DSH_DLX_BIN='dlx'
DSH_DLX_ALLOW_NODE_PTY='--allow-build=node-pty'
DSH_DLX_ALLOW_PROTOBUFJS='--allow-build=protobufjs'
DSH_DLX_ALLOW_SUBPROCESS='--allow-build=@deepseek-ai/dsh-subprocess-local'
DSH_DLX_ALLOW_KOFFI='--allow-build=koffi'
DSH_DLX_PACKAGE='@deepseek-ai/dsh@0.1.0-rc.8'

run_dsh() {
  if [ "$DSH_MODE" = pnpm ]; then
    # pnpm dlx executes the package's declared bin directly; the extra `dsh`
    # token would be treated as a CLI subcommand and breaks `plugin add`.
    # The build allow-list is scoped to this invocation so pnpm 11 never opens
    # its interactive approve-builds prompt in a fresh dlx environment.
    pnpm "$DSH_DLX_BIN" "$DSH_DLX_ALLOW_NODE_PTY" "$DSH_DLX_ALLOW_PROTOBUFJS" "$DSH_DLX_ALLOW_SUBPROCESS" "$DSH_DLX_ALLOW_KOFFI" "$DSH_DLX_PACKAGE" "$@"
  else
    "$DSH_CMD" "$@"
  fi
}

if [ "${1:-}" = "--probe-default-cli" ]; then
  run_dsh --version
  exit $?
fi

if [ "${1:-}" = "--probe-e2e-mode" ]; then
  [ -n "${DSH_PROBE_CAPTURE:-}" ] || die "DSH_PROBE_CAPTURE 未设置"
  # The fake pnpm used by the safety test stands in for the Playwright
  # boundary. This branch intentionally runs before scratch/profile setup so
  # it cannot install packages, contact the network, or touch a user home.
  DSH_E2E_EXPECT_ONBOARDING="$E2E_ONBOARDING_EXPECTED" \
    pnpm exec playwright test --probe-e2e-mode
  exit $?
fi

# scratch home（每次全新，绝不触碰真实 ~/.dsh）：调用方给了 DSH_HOME_BASE
# 时，只在其下新建本调用拥有的子目录并只隔离该子目录；缺省时直接用系统
# 临时目录（隔离目录不会由脚本删除）。
TEMP_BASE="${DSH_HOME_BASE:-}"
if [ -z "$TEMP_BASE" ]; then TEMP_BASE="$(node -p "require('node:os').tmpdir()")"; fi
SCRATCH_INFO="$(node "$SAFE_TEMP" create "$TEMP_BASE" "$ROOT" 'dsh-e2e-mount.')" \
  || die "无法创建受保护的 scratch 目录"
SCRATCH="$(node -p "JSON.parse(process.argv[1]).scratch" "$SCRATCH_INFO")"
SCRATCH_TOKEN="$(node -p "JSON.parse(process.argv[1]).token" "$SCRATCH_INFO")"
SERVER_PID=""
LAUNCHER_PID=""
CLEANED=0
cleanup() {
  local code=$?
  if [ "$CLEANED" -eq 1 ]; then return; fi
  CLEANED=1
  trap - EXIT 1 2 15
  if [ -n "$SERVER_PID" ]; then
    node "$SAFE_TEMP" terminate "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  if [ -n "$LAUNCHER_PID" ] && kill -0 "$LAUNCHER_PID" 2>/dev/null; then
    kill "$LAUNCHER_PID" 2>/dev/null || true
    wait "$LAUNCHER_PID" 2>/dev/null || true
  fi
  if [ -z "${KEEP_HOME:-}" ]; then
    if QUARANTINE_RESULT="$(node "$SAFE_TEMP" remove "$SCRATCH" "$TEMP_BASE" "$ROOT" 'dsh-e2e-mount.' "$SCRATCH_TOKEN" 2>&1)"; then
      if QUARANTINE_PATH="$(node -e 'const value=JSON.parse(process.argv[1]); if (typeof value.quarantine !== "string" || value.quarantine.length === 0) process.exit(1); process.stdout.write(value.quarantine)' "$QUARANTINE_RESULT" 2>/dev/null)"; then
        say "scratch 已隔离，未删除；请手动回收：$QUARANTINE_PATH"
      else
        warn "scratch cleanup 返回了无法解析的结果，已保留：$QUARANTINE_RESULT"
      fi
    else
      warn "scratch 安全校验失败，拒绝隔离：$QUARANTINE_RESULT"
    fi
  else
    warn "KEEP_HOME 已设置，保留 $SCRATCH"
  fi
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' 2
trap 'exit 143' 15
trap 'exit 129' 1

export DSH_HOME="$SCRATCH/home"
WORKSPACE_DIR="$SCRATCH/workspace"
LOG_DIR="$SCRATCH"
WEB_LOG="$LOG_DIR/web.log"
PID_FILE="$LOG_DIR/web.pid"
mkdir -p "$DSH_HOME/profiles/web" "$WORKSPACE_DIR"
# rc.8 may migrate a user's credentials into a newly-created DSH home before
# onboarding renders. Seed an owned, keyless document first so that migration
# has no opportunity to copy credentials from the real home. The scratch path
# is created by safe-temp and is the only path touched here.
umask 077
printf '{}\n' > "$DSH_HOME/.credentials.yaml"
chmod 600 "$DSH_HOME/.credentials.yaml" 2>/dev/null || true
say "scratch home: ${DSH_HOME}（DSH_HOME=${DSH_HOME}）"

if [ "${1:-}" = "--probe-scratch-credentials" ]; then
  [ -n "${DSH_PROBE_CAPTURE:-}" ] || die "DSH_PROBE_CAPTURE 未设置"
  # Test-only boundary: the fake runner verifies the owned scratch document
  # before any profile install, web launch, or network access can occur.
  run_dsh --probe-scratch-credentials
  exit $?
fi

# tarball 解析；未显式提供时始终自行 build + pack 到受保护的 scratch，
# 避免误用仓库里残留的旧产物。
if [ -z "$TARBALL" ]; then
  say "未提供 tarball，执行 pnpm build && pnpm pack ..."
  pnpm build
  pnpm pack --pack-destination "$SCRATCH" >/dev/null
  for candidate in "$SCRATCH"/dsh-better-sidebar-*.tgz; do
    if [ -f "$candidate" ]; then
      TARBALL="$candidate"
      break
    fi
  done
fi
[ -n "$TARBALL" ] && [ -f "$TARBALL" ] || die "找不到 tarball（TARBALL 或自动 pnpm pack 产物）"
TARBALL="$(cd "$(dirname "$TARBALL")" && pwd -P)/$(basename "$TARBALL")"
say "tarball: $TARBALL"

# 步骤 1：引导 scratch profile（web 模板，镜像 dsh initProfile；先写
# pnpm-workspace.yaml 的 allowBuilds / minimumReleaseAgeExclude，避免 pnpm 11
# strict-dep-builds 拦截 native hooks 或拒绝 <24h 新版本——同 install.sh）
PROFILE_DIR="$DSH_HOME/profiles/web"
cat > "$PROFILE_DIR/package.json" <<EOF
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": {},
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]
    }
  }
}
EOF
printf '[]\n' > "$PROFILE_DIR/cordis.patch.yml"
cat > "$PROFILE_DIR/pnpm-workspace.yaml" <<'EOF'
packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false

allowBuilds:
  node-pty: true
  protobufjs: true
  "@deepseek-ai/dsh-subprocess-local": true
  koffi: true

minimumReleaseAgeExclude:
  - dsh-better-sidebar
EOF

# 步骤 2：官方 CLI 安装 tarball + bundle 协调（真实挂载路径）
say "执行 dsh plugin --profile web add file:$TARBALL ..."
run_dsh plugin --profile web add "file:$TARBALL"

# 步骤 3：校验挂载生效（dsh.profile.bundles 含 dsh-better-sidebar）
if ! node -e '
  const fs = require("fs");
  const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const bundles = p.dsh?.profile?.bundles ?? [];
  process.exit(bundles.includes("dsh-better-sidebar") ? 0 : 1);
' "$PROFILE_DIR/package.json"; then
  warn "dsh-better-sidebar 未出现在 dsh.profile.bundles 中——挂载未注册"
  cat "$PROFILE_DIR/package.json"
  exit 1
fi
say "挂载已注册：dsh.profile.bundles 包含 dsh-better-sidebar"

# 步骤 4：启动 dsh web（--port 0 = OS 分配，避免端口冲突；keyless 可起）
say "启动 dsh web（port=${PORT}）..."
if [ "$DSH_MODE" = pnpm ]; then
  node "$SAFE_TEMP" launch "$PID_FILE" "$WEB_LOG" pnpm "$DSH_DLX_BIN" "$DSH_DLX_ALLOW_NODE_PTY" "$DSH_DLX_ALLOW_PROTOBUFJS" "$DSH_DLX_ALLOW_SUBPROCESS" "$DSH_DLX_ALLOW_KOFFI" "$DSH_DLX_PACKAGE" web --port "$PORT" &
else
  node "$SAFE_TEMP" launch "$PID_FILE" "$WEB_LOG" "$DSH_CMD" web --port "$PORT" &
fi
LAUNCHER_PID=$!

URL=""
for _ in $(seq 1 120); do
  if [ -z "$SERVER_PID" ] && [ -f "$PID_FILE" ]; then
    SERVER_PID="$(tr -d '\r\n' < "$PID_FILE")"
  fi
  if [ -z "$SERVER_PID" ] && ! kill -0 "$LAUNCHER_PID" 2>/dev/null; then
    echo "=== dsh web 提前退出，日志尾部 ===" >&2
    tail -30 "$WEB_LOG" >&2 || true
    exit 1
  fi
  if [ -n "$SERVER_PID" ] && ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "=== dsh web 提前退出，日志尾部 ===" >&2
    tail -30 "$WEB_LOG" >&2 || true
    exit 1
  fi
  if URL="$(grep -oE 'dsh web: http://127\.0\.0\.1:[0-9]+' "$WEB_LOG" | head -1 | awk '{print $3}')" && [ -n "$URL" ]; then
    break
  fi
  sleep 1
done
[ -n "$URL" ] || { echo "=== 120s 内未等到 dsh web 就绪，日志尾部 ===" >&2; tail -40 "$WEB_LOG" >&2 || true; exit 1; }
say "dsh web 就绪：${URL}（pid ${SERVER_PID}）"

# 步骤 5：运行无头渲染 lane
say "运行 Playwright 无头渲染 lane..."
DSH_E2E_EXPECT_ONBOARDING="$E2E_ONBOARDING_EXPECTED" \
DSH_E2E_URL="$URL" DSH_E2E_WORKSPACE="$WORKSPACE_DIR" \
  pnpm exec playwright test ${GREP_FILTER:+--grep "$GREP_FILTER"}

say "通过：插件挂载到真实 DSH 后无头渲染未崩溃"
