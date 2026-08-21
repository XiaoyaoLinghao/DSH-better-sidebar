## =============================================================================
# dsh-better-sidebar 一键安装脚本（官方 CLI 方式，Windows PowerShell 5.1+ / pwsh）
#
# 通过 DSH 官方插件命令安装 npm 包并自动挂载：
#   dsh plugin --profile web add dsh-better-sidebar@<version>
#
# 包内声明了 dsh.bundle.patch（cordis.patch.yml）：CLI 的 bundle 协调会把它
# 自动加进 profile 的 dsh.profile.bundles，下次启动即挂载——无需手动写
# cordis.patch.yml 挂载行。符合仓库硬约束：不修改 DSH 源码，插件永远作为
# 独立包被 profile 引用。
#
# 用法（任选其一）：
#   # 默认最新版
#   irm https://raw.githubusercontent.com/omdsh-dev/DSH-better-sidebar/main/scripts/install.ps1 | iex
#   # 指定版本 / 装完重启
#   & ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/omdsh-dev/DSH-better-sidebar/main/scripts/install.ps1'))) -Version 0.10.2 -Restart
#   # 本地保存后运行
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Version 0.10.2 -DryRun
#   # 从源码构建并安装到 profile
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Source -Profile web
#   # 修复 node-pty 依赖（终端提示「node-pty 加载失败」时用，见 issue #140）
#   powershell -ExecutionPolicy Bypass -File install.ps1 -Repair
#
# 参数：
#   -Version    npm 版本号/范围，缺省 latest（自动解析为最新）。
#   -Repair     修复模式：不重装插件，只确保 profile 的 pnpm-workspace.yaml
#               放行 node-pty 构建脚本，然后重跑 pnpm install + pnpm rebuild
#               node-pty。
#   -Source     从当前脚本所在源码 checkout 构建 tarball 并安装。
#   -Profile    目标 profile 名（缺省 web）；安装与修复模式均适用。
#   -Restart    装完后尝试 `pm2 restart dsh-web`（无 pm2 时仅提示）。会断开当前页面会话。
#   -DryRun     只打印将要执行的操作，不写任何文件。
#
# 环境变量（均可省略）：
#   DSH_HOME    默认 %USERPROFILE%\.dsh
#   REGISTRY    默认 https://registry.npmjs.org
#   DSH_CMD     默认优先 PATH 上的 dsh，缺省回退 npx -y --package @deepseek-ai/dsh
#
# 说明：
# - pnpm 11 的 strict-dep-builds 会拦截四个 native 依赖的构建脚本并使
#   `dsh plugin add` 非零退出。脚本会先把四个 native 构建许可写进 profile 的
#   pnpm-workspace.yaml（幂等），保证 CLI 一步成功。
# - pnpm 11 的 minimumReleaseAge 会拒绝发布 <24h 的新版本。脚本会预写
#   minimumReleaseAgeExclude（幂等），放行本插件，避免"重跑一次才成功"。
# - 老版本（<0.10.2）用手动挂载行，bundle 通道激活后需移除，否则双挂载。
#   脚本会幂等移除 better-sidebar 挂载行。
# =============================================================================
param(
  [string]$Version = '',
  [switch]$Source,
  [switch]$Restart,
  [switch]$DryRun,
  [switch]$Repair,
  [string]$Profile = 'web'
)

$PKG = 'dsh-better-sidebar'
$REGISTRY = if ($env:REGISTRY) { $env:REGISTRY } else { 'https://registry.npmjs.org' }

# DSH_HOME：DSH_HOME 环境变量 > %USERPROFILE% > $HOME
if ($env:DSH_HOME) {
  $DSH_HOME = $env:DSH_HOME
} elseif ($env:USERPROFILE) {
  $DSH_HOME = Join-Path $env:USERPROFILE '.dsh'
} else {
  $DSH_HOME = Join-Path $HOME '.dsh'
}
$PROFILE_DIR = Join-Path $DSH_HOME "profiles\$Profile"
$WS_YML = Join-Path $PROFILE_DIR 'pnpm-workspace.yaml'
$PATCH_YML = Join-Path $PROFILE_DIR 'cordis.patch.yml'

function Say([string]$m)  { Write-Host "[install] $m" -ForegroundColor Green }
function Warn([string]$m) { Write-Host "[warn] $m" -ForegroundColor Yellow }
function Die([string]$m)  { Write-Host "[error] $m" -ForegroundColor Red; exit 1 }

if ($Source -and $Repair) { Die '-Source 不能与 -Repair 同时使用。' }
if ($Source -and -not [string]::IsNullOrWhiteSpace($Version)) { Die '-Source 不能与 -Version 同时使用。' }

# 解析版本 -> npm spec（"x.y.z" / "^x.y.z" / latest）
function Resolve-Spec {
  param([string]$Given)
  if ([string]::IsNullOrWhiteSpace($Given) -or $Given -eq 'latest') {
    $v = $null
    foreach ($tool in @('npm', 'pnpm')) {
      if (Get-Command $tool -ErrorAction SilentlyContinue) {
        $v = (& $tool view $PKG version "--registry=$REGISTRY" 2>$null | Select-Object -Last 1)
        if ($v) { break }
      }
    }
    if ($v) { return ([string]$v).Trim() }
    Warn '无法联网解析最新版本（npm/pnpm 查询失败），回退为 latest，由 pnpm 直接解析。'
    Warn '若已知版本号，可显式传入：-Version 0.10.2'
    return 'latest'
  }
  return $Given
}

# 组装 dsh CLI：优先 PATH 上的 dsh，缺省 npx 拉官方包
function Get-DshCli {
  if ($env:DSH_CMD) {
    return [pscustomobject]@{
      Executable = [string]$env:DSH_CMD
      Prefix = @()
    }
  }
  if (Get-Command dsh -ErrorAction SilentlyContinue) {
    return [pscustomobject]@{
      Executable = 'dsh'
      Prefix = @()
    }
  }
  if (Get-Command npx -ErrorAction SilentlyContinue) {
    return [pscustomobject]@{
      Executable = 'npx'
      Prefix = @('-y', '--package', '@deepseek-ai/dsh', 'dsh')
    }
  }
  return $null
}

function Invoke-Native {
  param(
    [string]$Executable,
    [string[]]$Arguments
  )
  try {
    $nativeOutput = @(& $Executable @Arguments 2>&1)
    $nativeSucceeded = $?
    $nativeExitCode = $LASTEXITCODE
    return [pscustomobject]@{
      Output = $nativeOutput
      Succeeded = $nativeSucceeded
      ExitCode = $nativeExitCode
    }
  } catch {
    return [pscustomobject]@{
      Output = @($_.Exception.Message)
      Succeeded = $false
      ExitCode = $null
    }
  }
}

function Test-NativeSuccess {
  param([object]$Result)
  return $Result.Succeeded -eq $true -and $Result.ExitCode -is [int] -and $Result.ExitCode -eq 0
}

# 步骤 1（安装与修复共用）：预写 workspace 设置（幂等），保证 pnpm 不拦截
# node-pty/protobufjs/@deepseek-ai/dsh-subprocess-local/koffi 构建脚本、放行本插件新版本
function Ensure-WorkspaceSettings {
  $wsScript = @'
const fs = require("fs");
const p = process.argv[2];
let t = fs.readFileSync(p, "utf8");
const before = t;
const allowBuildEntries = ["node-pty", "protobufjs", "@deepseek-ai/dsh-subprocess-local", "koffi"];
const quote = String.fromCharCode(39);
const yamlKey = (name) => name.startsWith("@") ? quote + name + quote : name;
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const keyPattern = (name) => {
  const escaped = escapeRegex(name);
  return new RegExp("^([ \\t]*)(?:" + escaped + "|" + quote + escaped + quote + "|\\\"" + escaped + "\\\"):\\s*.*$", "m");
};
if (!/^\s*allowBuilds:\s*$/m.test(t)) {
  t += "\nallowBuilds:\n" + allowBuildEntries.map((name) => "  " + yamlKey(name) + ": true").join("\n") + "\n";
} else {
  const missing = [];
  for (const name of allowBuildEntries) {
    const pattern = keyPattern(name);
    if (pattern.test(t)) {
      t = t.replace(pattern, "$1" + yamlKey(name) + ": true");
    } else {
      missing.push("  " + yamlKey(name) + ": true");
    }
  }
  if (missing.length) t = t.replace(/^(\s*allowBuilds:\s*)$/m, "$1\n" + missing.join("\n"));
}
const hasDeepseekApproval = t.split(/\r?\n/).some((line) => {
  const value = line.trim();
  const q = String.fromCharCode(39);
  return value === "- @deepseek-ai/*"
    || value === "- " + q + "@deepseek-ai/*" + q
    || value === '- "@deepseek-ai/*"';
});
if (!hasDeepseekApproval) {
  if (/^\s*minimumReleaseAgeExclude:\s*$/m.test(t)) {
    t = t.replace(/^(\s*minimumReleaseAgeExclude:\s*)$/m, "$1\n  - " + String.fromCharCode(39) + "@deepseek-ai/*" + String.fromCharCode(39));
  } else {
    t += "\nminimumReleaseAgeExclude:\n  - " + String.fromCharCode(39) + "@deepseek-ai/*" + String.fromCharCode(39) + "\n";
  }
}
const hasPackageApproval = t.split(/\r?\n/).some((line) => {
  const value = line.trim();
  const q = String.fromCharCode(39);
  return value === "- dsh-better-sidebar"
    || value === "- " + q + "dsh-better-sidebar" + q
    || value === '- "dsh-better-sidebar"';
});
if (!hasPackageApproval) {
  if (/^\s*minimumReleaseAgeExclude:\s*$/m.test(t)) {
    t = t.replace(/^(\s*minimumReleaseAgeExclude:\s*)$/m, "$1\n  - dsh-better-sidebar");
  } else {
    t += "\nminimumReleaseAgeExclude:\n  - dsh-better-sidebar\n";
  }
}
if (t !== before) fs.writeFileSync(p, t);
console.log(t === before ? "unchanged" : "updated");
'@
  # PowerShell 5.1 把含内嵌双引号的多行 JS 作为参数传给 `node -e` 时，引号会被
  # Windows 命令行解析吞掉，导致 JS 语法错误（Expected ',', got ':'）。
  # 改用临时文件方式，兼容 PS 5.1 与 pwsh 7。
  $wsJs = Join-Path $env:TEMP ("dshbs-ws-" + [guid]::NewGuid().ToString("N") + ".js")
  Set-Content -LiteralPath $wsJs -Value $wsScript -Encoding UTF8
  $wsOut = & node @($wsJs, $WS_YML) 2>&1
  $wsCode = $LASTEXITCODE
  Remove-Item -LiteralPath $wsJs -Force -ErrorAction SilentlyContinue
  $wsResult = (($wsOut | Out-String)).Trim()
  if ($wsCode -ne 0) { Die "处理 $WS_YML 失败（node 退出码 $wsCode）：$wsResult" }
  if ($wsResult -eq 'updated') {
    Say "已确保 $WS_YML：allowBuilds（四个 native 依赖: true）+ minimumReleaseAgeExclude（$PKG）"
  } else {
    Say 'workspace 设置已就绪，跳过'
  }
}

# 前置校验
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Die '未找到 node（DSH 运行需要 Node.js >= 20），请先安装 Node.js 并加入 PATH。'
}
if (-not (Test-Path $PROFILE_DIR)) {
  Die "找不到 profile 目录：$PROFILE_DIR（请先安装并运行过一次 dsh web）"
}
if (-not (Test-Path $WS_YML)) {
  Die "找不到 $WS_YML（请先初始化 $Profile profile）"
}

# ── 修复模式（issue #140）：不重装插件，只修复 node-pty 依赖 ────────────
# 终端提示「node-pty 加载失败」时运行：确保 allowBuilds 后重跑
# pnpm install + pnpm rebuild node-pty（重放被 pnpm 11 拦截的构建脚本）。
if ($Repair) {
  if ($DryRun) {
    Say "[dry-run] 修复：确保 $WS_YML 含 allowBuilds（四个 native 依赖: true）"
    Say "[dry-run] 修复：cd $PROFILE_DIR; pnpm install; pnpm rebuild node-pty"
    exit 0
  }
  Say "修复模式：重装 node-pty（profile: $Profile，$PROFILE_DIR）..."
  Ensure-WorkspaceSettings
  Push-Location $PROFILE_DIR
  try {
    pnpm install
    if ($LASTEXITCODE -ne 0) { Die "pnpm install 失败（退出码 $LASTEXITCODE）。请确认 pnpm 在 PATH 上、网络可用，然后重试。" }
    pnpm rebuild node-pty
    if ($LASTEXITCODE -ne 0) { Die "pnpm rebuild node-pty 失败（退出码 $LASTEXITCODE）。请确认 pnpm 在 PATH 上，然后重试。" }
  } finally {
    Pop-Location
  }
  Say '修复完成：node-pty 已重装（与 DSH 核心保持同一版本）。请重启 DSH 后重试终端。'
  exit 0
}

$INSTALL_SPEC = ''
$SOURCE_VERSION = ''
if ($Source) {
  $ROOT = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  $ARTIFACT_DIR = Join-Path $ROOT '.artifacts'
  try {
    $sourcePackage = Get-Content -Raw -LiteralPath (Join-Path $ROOT 'package.json') -ErrorAction Stop | ConvertFrom-Json
    $sourceManifest = Get-Content -Raw -LiteralPath (Join-Path $ROOT 'dsh.plugin.json') -ErrorAction Stop | ConvertFrom-Json
  } catch {
    Die "源码 manifest 校验失败：$($_.Exception.Message)"
  }
  $sourceName = $sourcePackage.name
  $sourceVersionValue = $sourcePackage.version
  $manifestVersionValue = $sourceManifest.version
  if (($sourceName -isnot [string]) -or [string]::IsNullOrEmpty([string]$sourceName) -or -not [string]::Equals([string]$sourceName, 'dsh-better-sidebar', [StringComparison]::Ordinal)) {
    Die "源码包名异常：$sourceName"
  }
  if (($sourceVersionValue -isnot [string]) -or [string]::IsNullOrEmpty([string]$sourceVersionValue) -or ($manifestVersionValue -isnot [string]) -or [string]::IsNullOrEmpty([string]$manifestVersionValue)) {
    Die '源码 manifest 版本必须是非空字符串。'
  }
  if (-not [string]::Equals([string]$sourceVersionValue, [string]$manifestVersionValue, [StringComparison]::Ordinal)) {
    Die '源码 manifest 版本不一致。'
  }
  $SOURCE_VERSION = [string]$sourceVersionValue
  $TARBALL = Join-Path $ARTIFACT_DIR "dsh-better-sidebar-$SOURCE_VERSION.tgz"

  Set-Location -LiteralPath $ROOT
  $CLI_INFO = Get-DshCli
  if (-not $CLI_INFO) {
    Die '未找到 dsh 或 npx。请先安装 DSH（并确保 Node/npm 可用），或用 DSH_CMD 指定。'
  }
  $CLI = [string]$CLI_INFO.Executable
  $CLI_PREFIX = @($CLI_INFO.Prefix)
  $CLI_LABEL = if ($CLI_PREFIX.Count -gt 0) { "$CLI $($CLI_PREFIX -join ' ')" } else { $CLI }
  Say "目标：$CLI_LABEL plugin --profile $Profile add file:$TARBALL（源码构建，profile: $PROFILE_DIR）"

  if ($DryRun) {
    Say "[dry-run] 源码根目录：$ROOT"
    Say "[dry-run] 源码版本：$SOURCE_VERSION"
    Say "[dry-run] 产物路径：$TARBALL"
    Say '[dry-run] 步骤 1：验证 DSH 版本（要求 0.1.0-rc.8）'
    Say '[dry-run] 步骤 2：执行 pnpm install --frozen-lockfile'
    Say '[dry-run] 步骤 3：执行 pnpm build'
    Say "[dry-run] 步骤 4：执行 pnpm pack --pack-destination $ARTIFACT_DIR"
    Say "[dry-run] 步骤 5：$CLI_LABEL plugin --profile $Profile add file:$TARBALL"
    exit 0
  }

  $versionProbeArgs = @($CLI_PREFIX) + @('--version')
  $versionResult = Invoke-Native -Executable $CLI -Arguments $versionProbeArgs
  $versionText = (($versionResult.Output | Out-String)).Trim()
  $versionLines = $versionText -split '\r?\n'
  $observedVersion = if ($versionLines.Count -gt 0) { ([string]$versionLines[$versionLines.Count - 1]).Trim() } else { '' }
  if (-not (Test-NativeSuccess $versionResult) -or $observedVersion -ne '0.1.0-rc.8') {
    Die "源码版要求 DSH 0.1.0-rc.8，当前为 $observedVersion。"
  }

  # 源码构建必须先获得 DSH 版本确认，再写入 profile 配置。
  Ensure-WorkspaceSettings
  $pnpmResult = Invoke-Native -Executable 'pnpm' -Arguments @('install', '--frozen-lockfile')
  if (-not (Test-NativeSuccess $pnpmResult)) { Die "pnpm install 失败（退出码 $($pnpmResult.ExitCode)）。" }
  $pnpmResult = Invoke-Native -Executable 'pnpm' -Arguments @('build')
  if (-not (Test-NativeSuccess $pnpmResult)) { Die "pnpm build 失败（退出码 $($pnpmResult.ExitCode)）。" }
  New-Item -ItemType Directory -Force -Path $ARTIFACT_DIR | Out-Null
  $pnpmResult = Invoke-Native -Executable 'pnpm' -Arguments @('pack', '--pack-destination', $ARTIFACT_DIR)
  if (-not (Test-NativeSuccess $pnpmResult)) { Die "pnpm pack 失败（退出码 $($pnpmResult.ExitCode)）。" }
  if (-not (Test-Path -LiteralPath $TARBALL -PathType Leaf)) {
    Die "pnpm pack 未生成预期 tarball：$TARBALL"
  }
  $INSTALL_SPEC = "file:$TARBALL"
} else {
  $SPEC = Resolve-Spec $Version
  $CLI_INFO = Get-DshCli
  if (-not $CLI_INFO) {
    Die '未找到 dsh 或 npx。请先安装 DSH（并确保 Node/npm 可用），或用 DSH_CMD 指定。'
  }
  $CLI = [string]$CLI_INFO.Executable
  $CLI_PREFIX = @($CLI_INFO.Prefix)
  $CLI_LABEL = if ($CLI_PREFIX.Count -gt 0) { "$CLI $($CLI_PREFIX -join ' ')" } else { $CLI }
  $INSTALL_SPEC = "$PKG@$SPEC"
  Say "目标：$CLI_LABEL plugin --profile $Profile add $INSTALL_SPEC（profile: $PROFILE_DIR）"

  if ($DryRun) {
    Say "[dry-run] 步骤 1：确保 $WS_YML 含 allowBuilds（四个 native 依赖: true）与 minimumReleaseAgeExclude（$PKG）"
    Say "[dry-run] 步骤 2：执行 $CLI_LABEL plugin --profile $Profile add $INSTALL_SPEC（安装 + bundle 自动注册）"
    Say "[dry-run] 步骤 3：校验 dsh.profile.bundles 含 $PKG"
    Say "[dry-run] 步骤 4：幂等移除 $PATCH_YML 里旧的 better-sidebar 手动挂载行（避免双挂载）"
    if ($Restart) { Say '[dry-run] 步骤 5：pm2 restart dsh-web' } else { Say '[dry-run] 步骤 5：提示用户手动重启 DSH' }
    exit 0
  }

  # 步骤 1：预写 workspace 设置（幂等），保证 pnpm 不拦截构建、放行本插件新版本
  Ensure-WorkspaceSettings
}

# 步骤 2：官方 CLI 安装 + bundle 自动注册（含挂载）
$cliArgs = @($CLI_PREFIX) + @('plugin', '--profile', $Profile, 'add', $INSTALL_SPEC)
Say "执行 $CLI_LABEL plugin --profile $Profile add $INSTALL_SPEC ..."
$addResult = Invoke-Native -Executable $CLI -Arguments $cliArgs
$addOut = $addResult.Output
if (-not (Test-NativeSuccess $addResult)) {
  Warn 'dsh plugin add 失败。已预写 allowBuilds 与 minimumReleaseAgeExclude，仍失败的可能原因：'
  Warn '  - 网络/登录问题：npm registry 不可达或需要登录。'
  Warn "  - 依赖安装冲突：可手动重试 cd $PROFILE_DIR; pnpm install。"
  exit 1
}
$addOut | ForEach-Object { $_ }

# 步骤 3：校验 bundle 已注册（挂载生效的判据）
$pkgJson = Get-Content -Raw (Join-Path $PROFILE_DIR 'package.json') | ConvertFrom-Json
$bundles = $pkgJson.dsh.profile.bundles
if ($bundles -notcontains $PKG) {
  Warn 'dsh-better-sidebar 未出现在 dsh.profile.bundles 中——挂载未注册。'
  Warn "若上面的 pnpm 输出提示 ignored build scripts，请确认 $WS_YML 的 allowBuilds 后重跑本脚本。"
  exit 1
}
Say "bundle 已注册：dsh.profile.bundles 包含 $PKG（下次启动自动挂载）"

if ($Source) {
  $installedManifestPath = Join-Path $PROFILE_DIR "node_modules\$PKG\package.json"
  try {
    $installedPackage = Get-Content -Raw -LiteralPath $installedManifestPath -ErrorAction Stop | ConvertFrom-Json
  } catch {
    Die "源码安装版本校验失败：无法读取 $installedManifestPath。"
  }
  if ($installedPackage.name -ne $PKG -or [string]$installedPackage.version -ne $SOURCE_VERSION) {
    Die "源码安装版本校验失败：profile 中的 $PKG 不是 $SOURCE_VERSION。"
  }
  Say "源码版本已校验：$PKG@$SOURCE_VERSION"
}

# 步骤 4：幂等移除旧的 manual 挂载行（避免与 bundle 双挂载）
$mountScript = @'
const fs = require("fs");
const p = process.argv[2];
const lines = fs.readFileSync(p, "utf8").split("\n");
const out = [];
let i = 0;
let removed = false;
while (i < lines.length) {
  const line = lines[i];
  if (/^[ \t]*- insert:\s*$/.test(line)) {
    const block = [line];
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== "" && !/^-\s/.test(lines[j])) {
      block.push(lines[j]);
      j++;
    }
    if (block.some((l) => /id:\s*better-sidebar\b/.test(l))) {
      while (out.length && /^[ \t]*#/.test(out[out.length - 1])) out.pop();
      i = j;
      removed = true;
      continue;
    }
  }
  out.push(line);
  i++;
}
if (!removed) {
  console.log("none");
} else {
  const t = out.join("\n").replace(/\n{3,}/g, "\n\n");
  fs.writeFileSync(p, t);
  console.log("removed");
}
'@
$mountJs = Join-Path $env:TEMP ("dshbs-mount-" + [guid]::NewGuid().ToString("N") + ".js")
Set-Content -LiteralPath $mountJs -Value $mountScript -Encoding UTF8
$mountOut = & node @($mountJs, $PATCH_YML) 2>&1
$mountCode = $LASTEXITCODE
Remove-Item -LiteralPath $mountJs -Force -ErrorAction SilentlyContinue
$mountResult = (($mountOut | Out-String)).Trim()
if ($mountCode -ne 0) { Die "处理 $PATCH_YML 失败（node 退出码 $mountCode）：$mountResult" }
if ($mountResult -eq 'removed') {
  Say "已从 $PATCH_YML 移除旧的 better-sidebar 手动挂载行（bundle 通道接管挂载）"
} else {
  Say '无旧手动挂载行，跳过'
}

Say "安装完成：$INSTALL_SPEC"

# 步骤 5：重启提示
if ($Restart) {
  if (Get-Command pm2 -ErrorAction SilentlyContinue) {
    Say '重启 dsh-web（pm2）...'
    pm2 restart dsh-web
    if ($LASTEXITCODE -ne 0) { Warn 'pm2 restart 失败，请手动重启 DSH' }
  } else {
    Warn '未找到 pm2，请手动重启 DSH（如：pm2 restart dsh-web 或 dsh web）'
  }
} else {
  Say '下一步：重启 DSH 并硬刷新（Ctrl+Shift+R / Cmd+Shift+R）使新副本生效。'
  if (Get-Command pm2 -ErrorAction SilentlyContinue) {
    Say '本机可用：pm2 restart dsh-web（会短暂断开当前页面会话）'
  }
}
