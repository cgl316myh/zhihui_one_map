# 智慧矿山一张图 · 前端（Vite）

仅接入 **Vite** 构建工具，业务脚本仍为原生 ES Module（未上 Vue / Pinia）。

## 开发

```bash
# 终端 1：传感器网关（API + MQTT/推送，端口 5173）
cd ../sensor_bridge
python gateway.py

# 终端 2：Vite 开发服（端口 5174，/api 自动代理到 5173）
cd ../frontend
npm install
npm run dev
```

浏览器打开：http://127.0.0.1:5174/

## 构建

```bash
npm run build
```

产物在 `dist/`。可将网关 `config.json` 的 `staticDir` 改为 `../frontend/dist`，用网关同时托管页面与 API。

## 目录说明

| 路径 | 说明 |
|------|------|
| `index.html` / `js/` / `css/` | 现有页面与脚本（改动极小） |
| `public/data/` | 静态 JSON（Vite 映射为 `/data/...`） |
| `data/` | 指向 `public/data` 的目录联接，兼容网关旧路径 |
| `vite.config.js` | 端口 5174、`/api` 代理 |

## 与旧方式对比

- 旧：`python serve.py` 或网关直接托管 `frontend/`
- 现：`npm run dev`（热更新）；生产 `npm run build` 后托管 `dist/`
