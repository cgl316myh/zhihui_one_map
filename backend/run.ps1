# 启动 Spring Boot（使用 resources/static，不再依赖 src/frontend）
# 用法：
#   .\run.ps1

$ErrorActionPreference = "Stop"
$BackendDir = $PSScriptRoot
$StaticDir = Join-Path $BackendDir "src\main\resources\static"

Write-Host "==> Backend : $BackendDir"
Write-Host "==> Static  : $StaticDir"
Write-Host "==> 使用现有 static（改 js/css/html 后重启即可）"

if (-not (Test-Path (Join-Path $StaticDir "index.html"))) {
  throw "static/index.html 不存在。请检查 src\backend\src\main\resources\static\"
}

$mvnArgs = @("spring-boot:run", "-Dskip.frontend=true")

Write-Host "==> mvn $($mvnArgs -join ' ')"
Write-Host "管理后台: http://127.0.0.1:8081/admin.html"

Push-Location $BackendDir
try {
  & mvn @mvnArgs
} finally {
  Pop-Location
}
