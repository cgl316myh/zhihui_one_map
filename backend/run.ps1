# 一键启动：构建前端 → 打入 static → 启动 Spring Boot（仅需本终端）
# 用法：在 backend 目录执行  .\run.ps1
# 跳过前端构建（已有 dist）：.\run.ps1 -SkipFrontend

param(
  [switch]$SkipFrontend
)

$ErrorActionPreference = "Stop"
$BackendDir = $PSScriptRoot
$FrontendDir = Join-Path $BackendDir "..\frontend" | Resolve-Path

Write-Host "==> Frontend: $FrontendDir"
Write-Host "==> Backend : $BackendDir"

if (-not $SkipFrontend) {
  Push-Location $FrontendDir
  try {
    if (-not (Test-Path "node_modules")) {
      Write-Host "==> npm ci"
      npm ci
    }
    Write-Host "==> npm run build"
    npm run build
  } finally {
    Pop-Location
  }
} else {
  Write-Host "==> Skip frontend build (-SkipFrontend)"
}

if (-not (Test-Path (Join-Path $FrontendDir "dist\index.html"))) {
  throw "frontend/dist 不存在，请先构建前端或去掉 -SkipFrontend"
}

$mvnArgs = @("spring-boot:run")
if ($SkipFrontend) {
  $mvnArgs = @("spring-boot:run", "-Dskip.frontend=true")
}

Write-Host "==> mvn $($mvnArgs -join ' ')"
Write-Host "启动后打开: http://127.0.0.1:8081/  （登录页，dev 默认 8081）"
Write-Host "一张图:     http://127.0.0.1:8081/index.html"
Write-Host "管理后台:   http://127.0.0.1:8081/admin.html"

Push-Location $BackendDir
try {
  & mvn @mvnArgs
} finally {
  Pop-Location
}
