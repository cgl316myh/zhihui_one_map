# 打包 mine-one-map-api：默认将 pom 补丁号 +1，再 mvn package，并复制到 .tools/uploads
# 用法：
#   .\package.ps1              # 1.3.0 -> 1.3.1 -> 打包
#   .\package.ps1 -NoBump      # 不改版本，只打包当前号
#   .\package.ps1 -SetVersion 1.4.0

param(
  [switch]$NoBump,
  [string]$SetVersion = ""
)

$ErrorActionPreference = "Stop"
$BackendRoot = $PSScriptRoot
$RepoRoot = (Resolve-Path (Join-Path $BackendRoot "..\..")).Path
$PomPath = Join-Path $BackendRoot "pom.xml"
$UploadsDir = Join-Path $RepoRoot ".tools\uploads"
$MvnCandidates = @(
  (Join-Path $RepoRoot ".tools\maven-local\apache-maven-3.9.9\bin\mvn.cmd"),
  "mvn.cmd",
  "mvn"
)

function Get-Mvn {
  foreach ($c in $MvnCandidates) {
    if ($c -eq "mvn" -or $c -eq "mvn.cmd") {
      $cmd = Get-Command $c -ErrorAction SilentlyContinue
      if ($cmd) { return $cmd.Source }
    } elseif (Test-Path -LiteralPath $c) {
      return $c
    }
  }
  throw "找不到 Maven（mvn）。请确认已安装或存在 .tools\maven-local"
}

function Get-ProjectVersion([string]$pomText) {
  # 跳过 parent 的 <version>，取工程自身 version（artifactId 之后第一个）
  if ($pomText -match '(?s)<artifactId>mine-one-map-api</artifactId>\s*<version>([^<]+)</version>') {
    return $Matches[1].Trim()
  }
  throw "无法从 pom.xml 解析 mine-one-map-api 版本"
}

function Set-ProjectVersion([string]$pomText, [string]$newVersion) {
  $pattern = '(?s)(<artifactId>mine-one-map-api</artifactId>\s*<version>)([^<]+)(</version>)'
  if ($pomText -notmatch $pattern) {
    throw "无法写入 pom.xml 版本"
  }
  return [regex]::Replace($pomText, $pattern, { param($m) $m.Groups[1].Value + $newVersion + $m.Groups[3].Value }, 1)
}

function Bump-Patch([string]$version) {
  if ($version -notmatch '^(\d+)\.(\d+)\.(\d+)(.*)$') {
    throw "版本号格式应为 x.y.z，当前: $version"
  }
  $major = [int]$Matches[1]
  $minor = [int]$Matches[2]
  $patch = [int]$Matches[3] + 1
  $suffix = $Matches[4]
  return "$major.$minor.$patch$suffix"
}

$pom = Get-Content -LiteralPath $PomPath -Raw -Encoding UTF8
$oldVersion = Get-ProjectVersion $pom
$newVersion = $oldVersion

if ($SetVersion) {
  $newVersion = $SetVersion.Trim()
} elseif (-not $NoBump) {
  $newVersion = Bump-Patch $oldVersion
}

if ($newVersion -ne $oldVersion) {
  $pom = Set-ProjectVersion $pom $newVersion
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [IO.File]::WriteAllText($PomPath, $pom, $utf8NoBom)
  # 同步 Java 默认回退版本（仅注释/缺省配置用）
  $appInfo = Join-Path $BackendRoot "src\main\java\com\anr\mineonemap\dashboard\AppInfoController.java"
  if (Test-Path -LiteralPath $appInfo) {
    $java = Get-Content -LiteralPath $appInfo -Raw -Encoding UTF8
    $java2 = [regex]::Replace(
      $java,
      '@Value\("\$\{mine\.app\.version:[^}]+\}"\)',
      "@Value(`"`${mine.app.version:$newVersion}`")"
    )
    if ($java2 -ne $java) {
      [IO.File]::WriteAllText($appInfo, $java2, $utf8NoBom)
    }
  }
  Write-Host "VERSION $oldVersion -> $newVersion" -ForegroundColor Cyan
} else {
  Write-Host "VERSION $newVersion (unchanged)" -ForegroundColor Yellow
}

$mvn = Get-Mvn
Write-Host "MVN $mvn" -ForegroundColor DarkGray
Set-Location -LiteralPath $BackendRoot
& $mvn -DskipTests "-Dskip.frontend=true" clean package
if ($LASTEXITCODE -ne 0) {
  throw "Maven package failed: exit $LASTEXITCODE"
}

$jarName = "mine-one-map-api-$newVersion.jar"
$jarPath = Join-Path $BackendRoot "target\$jarName"
if (-not (Test-Path -LiteralPath $jarPath)) {
  throw "未找到打包产物: $jarPath"
}

New-Item -ItemType Directory -Force -Path $UploadsDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$copyName = "mine-one-map-api-$newVersion`_$stamp.jar"
$copyPath = Join-Path $UploadsDir $copyName
Copy-Item -LiteralPath $jarPath -Destination $copyPath -Force

$item = Get-Item -LiteralPath $copyPath
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $copyPath).Hash

Write-Host ""
Write-Host "======== PACKAGE OK ========" -ForegroundColor Green
Write-Host "VERSION=$newVersion"
Write-Host "JAR=$($item.FullName)"
Write-Host "SIZE=$($item.Length)"
Write-Host "SHA256=$hash"
Write-Host "TARGET_ON_SERVER=D:\MineOneMap\app\mine-one-map-api.jar"
Write-Host "RELEASE_COPY=D:\MineOneMap\realease\mine-one-map-api-$newVersion.jar"
