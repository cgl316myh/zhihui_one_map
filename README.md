# src — 网站源码（Git 管理）

## 目录

```
src/
  backend/         # Spring Boot（含前端静态资源 static/）
  sensor_bridge/   # 传感器网关（可选；MQTT/HTTP 已内置后端）
  .github/         # GitHub Actions → Pages 部署
```

## 本机启动（推荐）

```powershell
cd src\backend
.\run.ps1
```

或 IDEA 运行 `MineOneMapApplication`，打开 http://127.0.0.1:8081/

前端改 `src/backend/src/main/resources/static/` 后重启后端即可。

## Git

本目录为独立 Git 仓库：

```bash
cd src
git status
```
