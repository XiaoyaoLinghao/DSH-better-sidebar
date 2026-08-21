# DSH Better Workbench

> 当前维护仓库、版本、DSH rc.8 基线、兼容包名/插件 id/服务、源码优先通道。

## 核心能力

DSH Better Workbench 是面向 DeepSeek Harness 的会话隔离工作台：右侧栏和底部面板提供文件树、编辑与预览、真实终端、Git、浏览器和后台任务视图。布局、Tab 与面板状态按会话持久化；内置 Tab 和第三方扩展都通过 `ctx.betterSidebar` 服务注册。

当前维护仓库是 [XiaoyaoLinghao/DSH-better-workbench](https://github.com/XiaoyaoLinghao/DSH-better-workbench)，发布版本为 `0.15.0-xlh.1`。为保持 DSH 生态兼容，npm 包名仍为 `dsh-better-sidebar`，插件 id 仍为 `dsh-better-sidebar`，服务仍为 `ctx.betterSidebar`。

源码版成功条件：profile 中安装的版本为 `0.15.0-xlh.1`，且 profile bundle 包含 `dsh-better-sidebar`。

## 原生 Sidechain

原生 Sidechain 是普通的、可本地化、可禁用、按会话持久化的侧边栏 Tab：

- `/side <问题>` 创建可继续的 child conversation，可在 Sidechain Tab 中继续提问。
- `/btw <问题>` 创建一次性、只读的 child conversation。
- `/side list` 列出当前父会话的直接 child；Subagent Tab 仍负责完整拓扑、后台任务和跨会话跳转。

两条创建命令都要求非空问题。`fork` 是 DSH subagent provider 的语义，不是 Git fork。host 配置使用嵌套 YAML：

```yaml
config:
  sidechain:
    providerName: fork
    readOnlyTools: [read, grep, glob]
```

Sidechain 开关只控制 Tab 可见性与自动打开，不注销 host 命令。本模块仅支持 DSH `0.1.0-rc.8`；改编自 `dsh-external/dsh-better-sidebar` 的 `dsh-sidechain` 参考代码保留 provenance 注释，完整 BSD-3-Clause 版权、条件与免责声明见 [`THIRD_PARTY_NOTICES`](./THIRD_PARTY_NOTICES)。参考项目贡献者不代表本项目背书。

## 源码安装

前置条件：已安装并能启动 `dsh web` 的 DSH `0.1.0-rc.8`、Node.js ≥ 20、pnpm ≥ 10。克隆当前维护仓库后，从仓库根目录选择一个平台命令：

```bash
git clone https://github.com/XiaoyaoLinghao/DSH-better-workbench.git
cd DSH-better-workbench
```

<!-- source-install:bash -->
```bash
bash scripts/install.sh --source --profile web
```

<!-- source-install:powershell -->
```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -Source -Profile web
```

安装器会构建当前源码 tarball，通过 DSH 官方 CLI 将绝对路径 tarball 安装到 profile，并自动协调 `dsh.profile.bundles`。成功后硬刷新浏览器（Cmd/Ctrl+Shift+R）；安装器不会隐式重启 DSH。

## 供 DSH / 自动化代理读取

- 从源码仓库根目录执行上面的一个平台命令，不要同时执行两个命令。
- 成功判据是安装版本 `0.15.0-xlh.1` 且 profile bundle 含 `dsh-better-sidebar`。
- 命令失败时停止并报告失败原因；不要回退到 npm 安装。
- 源码通道不修改 DSH 源码，插件始终由 profile 作为独立包挂载。

## 更新、卸载与回滚

更新时先拉取维护仓库，再重复对应平台的源码命令：

```bash
git pull
bash scripts/install.sh --source --profile web
```

PowerShell 用户执行 `git pull` 后重新运行上面的 PowerShell 命令。

卸载使用 DSH 官方命令：

```bash
dsh plugin --profile web remove dsh-better-sidebar
```

源码安装后保留 `.artifacts/dsh-better-sidebar-0.15.0-xlh.1.tgz`。回滚时必须使用绝对 tarball 路径：

```bash
ARTIFACT="$(pwd)/.artifacts/dsh-better-sidebar-0.15.0-xlh.1.tgz"
dsh plugin --profile web add "file:${ARTIFACT}"
```

```powershell
$artifact = Join-Path (Get-Location) '.artifacts/dsh-better-sidebar-0.15.0-xlh.1.tgz'
dsh plugin --profile web add "file:$artifact"
```

如果安装失败，不要自动切换到 `dsh-better-sidebar@latest`。

## Sidechain 配置

通过 profile 的 `cordis.patch.yml` 和配置机制提供 Sidechain 配置；不要修改 DSH 官方源码，也不要把插件代码复制进 DSH checkout。`providerName` 缺省为 `fork`，`readOnlyTools` 未设置时不增加 allow-list 限制。需要更改 host 配置时，重启 DSH 后再硬刷新页面。

## 开发与构建

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test
pnpm watch
```

这是一个同时提供 host/client halves 的 npm 包：host 提供 session-scoped 文件、Git、预览与终端路由，client 提供工作台 UI 与服务注册表。消费插件以 peer dependency 使用 `dsh-better-sidebar`，在 client half 通过 `ctx.betterSidebar.registerTab` 或 `registerFileViewer` 扩展；使用 `ctx.effect` 管理 disposer，避免 HMR 重复注册。完整字段和生命周期说明见 [`AGENTS.md`](./AGENTS.md) 与 [`docs/external-plugin-guide.md`](./docs/external-plugin-guide.md)。

## 安全与限制

- 文件写入走原子操作，路由受 Host-header trust fence 保护，并限制在当前 session cwd 内。
- HTML 预览和浏览器默认运行在 opaque-origin sandbox iframe；关闭 sandbox 会显示警告，只应对完全可信内容使用。
- 地址栏拒绝 `javascript:`、`data:`、`file:` 和本地地址；受 `X-Frame-Options` 或 `frame-ancestors` 限制的网站可能无法嵌入。
- Git 面板不提供 push/pull/fetch；没有文件 watcher，需要手动刷新。Office 预览（`.docx` / `.xlsx` / `.pptx`）由推荐插件提供。
- 移动端窄视口将底部面板合并到右侧栏；终端 Tab 跨 pane 移动时会重新挂载 shell。

## 平台支持

支持 Windows、Linux、macOS。Node.js ≥ 20、pnpm ≥ 10 和 DSH `0.1.0-rc.8` 是源码安装基线。`node-pty` 优先使用预构建二进制；若需本地编译，Windows 需要 VS Build Tools，Linux 需要 make、g++ 和 Python 3，macOS 需要 Xcode Command Line Tools。

## 上游来源

本 fork 的上游仓库是 [omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)。`dsh-better-sidebar@latest` 指向上游 npm 发布通道，不是本 fork；要安装本 fork，请使用“源码安装”中的命令。Sidechain 改编代码的完整归属和许可证见 [`THIRD_PARTY_NOTICES`](./THIRD_PARTY_NOTICES)。
