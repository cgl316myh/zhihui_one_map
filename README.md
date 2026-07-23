# src — 网站源码（Git 管理）

## 目录

```
src/
  frontend/        # Vite 前端大屏（可单独静态部署）
  sensor_bridge/   # 传感器网关（本地可选，GitHub Pages 不需要）
  .github/         # GitHub Actions → Pages 部署
```

## 推荐：GitHub Pages 静态演示

不启动网关，用 mock 数据展示全部功能。说明见 **[DEPLOY_GITHUB_PAGES.md](./DEPLOY_GITHUB_PAGES.md)**。

发布后地址示例：`https://cgl316myh.github.io/zhihui_one_map/`

## 本机一键启动（含可选网关）

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
