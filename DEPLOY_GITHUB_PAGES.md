# GitHub Pages 静态演示部署

本仓库前端可**不依赖传感器网关**，以本地 mock JSON 展示全部演示功能，适合发布到 GitHub Pages。

## 访问地址

推送并完成 Actions 后：

`https://cgl316myh.github.io/zhihui_one_map/`

（仓库名若变更，域名路径随之变化。）

## 一次性设置

1. 打开 GitHub 仓库 → **Settings** → **Pages**
2. **Build and deployment** → **Source** 选 **GitHub Actions**
3. 将本仓库代码推送到 `master` / `main`（或手动跑 workflow **Deploy Pages**）
4. 等待 Actions 绿色通过后打开上面的地址

## 演示账号

| 账号 | 密码 | 说明 |
|------|------|------|
| `admin` | `123456` | 管理员：大屏 + 管理后台 |
| `user` | `123456` | 普通用户：仅大屏 |

登录页有验证码，按页面图形填写。

## 演示范围（全部可用）

- 登录 / 注册 / 退出
- 一张图：环境、生产、边坡、视频、储量等面板与图层
- 边坡预警 / 消警（演示态）
- 储量录入（管理员）
- 管理后台：用户、阈值、字典、地图源与密钥、**数据接入配置界面**、操作日志

监测数值来自 `frontend/public/data/*.json`，存在浏览器本地的配置（阈值、字典等）写在 **localStorage**，换浏览器会重置为默认。

## 与本地网关的区别

| | GitHub Pages 静态演示 | 本机 `start.bat` |
|--|----------------------|------------------|
| 前端 | ✅ | ✅ |
| mock 数据 | ✅ | ✅ |
| 真实 MQTT / HTTP 推送 | ❌（不需要） | 可选（`sensor_bridge`） |
| 「同步到网关」 | 提示已跳过，配置仍可保存/导出 | 可写入 `config.json` |

开关：`frontend/js/demoMode.js` 中 `STATIC_DEMO = true`（默认）。接真网关时改为 `false` 并启动 `python gateway.py`。

## 本地预览构建产物（可选）

```bash
cd frontend
npm ci
npm run build
npm run preview
```

打开 http://127.0.0.1:5174/ （预览服仍会尝试代理 `/api`，静态演示可不理会）。
