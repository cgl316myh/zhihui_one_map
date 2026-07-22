# src — 网站源码（Git 管理）

## 目录

```
src/
  frontend/        # Vite 前端大屏
  sensor_bridge/   # 传感器网关（MQTT / HTTP 推送 / API）
```

## 启动

在项目根目录（`监控系统/`）双击 `start.bat`，或：

```bash
python start.py
```

- 前端开发服：http://127.0.0.1:5174/
- 网关 API：http://127.0.0.1:5173/

## Git

本目录为独立 Git 仓库：

```bash
cd src
git status
```
