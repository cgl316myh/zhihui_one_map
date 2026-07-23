# 智慧矿山一张图 · 前端（Vite）

仅接入 **Vite** 构建工具，业务脚本仍为原生 ES Module（未上 Vue / Pinia）。

默认 **静态演示模式**（`js/demoMode.js` → `STATIC_DEMO = true`）：全部监测数据读本地 JSON，可直接发布到 **GitHub Pages**，见仓库根目录 [DEPLOY_GITHUB_PAGES.md](../DEPLOY_GITHUB_PAGES.md)。

## 开发（仅前端）

```bash
cd frontend
npm install
npm run dev
```

浏览器打开：http://127.0.0.1:5174/  
演示账号：`admin` / `123456`（后台）、`user` / `123456`（大屏）。

## 开发（可选：本地传感器网关）

将 `js/demoMode.js` 中 `STATIC_DEMO` 改为 `false` 后：

```bash
# 终端 1：传感器网关（API + MQTT/推送，端口 5173）
cd ../sensor_bridge
python gateway.py

# 终端 2：Vite 开发服（端口 5174，/api 自动代理到 5173）
cd ../frontend
npm run dev
```

## 构建

```bash
npm run build
```

产物在 `dist/`。GitHub Actions 会自动构建并发布到 Pages；本机也可将网关 `staticDir` 指向 `../frontend/dist`。

## 目录说明

| 路径 | 说明 |
|------|------|
| `index.html` / `js/` / `css/` | 页面与脚本 |
| `public/data/` | 静态 mock JSON |
| `vite.config.js` | `base: './'`（适合 GitHub 项目页） |
