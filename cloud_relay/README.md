# 云端 HTTP 环境数据中转（模式 B）

轻量服务，**不装 PostgreSQL**。用 SQLite 缓冲约 24 小时。

## 启动

```bash
cd src/cloud_relay
python app.py
```

可选环境变量：

| 变量 | 默认 | 说明 |
|------|------|------|
| `RELAY_PORT` | `8787` | 监听端口 |
| `RELAY_TOKEN` | 空 | 若设置，要求 `Authorization: Bearer` 或 `X-Push-Token` |
| `RELAY_HOURS` | `24` | 缓冲小时数 |
| `RELAY_DB` | `./relay.sqlite` | SQLite 路径 |

## 接口

- `POST /api/push` — 厂商推送
- `GET /api/relay/latest` — 每 clientId 最新一条（数组）
- `GET /api/relay/since?t=ISO8601` — 补拉
- `GET /api/relay/health` — 健康检查

## 内网配置

管理后台 → **接入连接** → HTTP 模式选「云端中转」，填写云机 `baseUrl`（如 `http://x.x.x.x:8787`），保存后可在 **接入测试** 测连通 / 立即拉取。
