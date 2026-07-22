# 智慧矿山传感器网关（MQTT + HTTP 推送）

## 文档依据

- `传感器mqtt数据接入说明20250401.pdf`：设备经 MQTT 上报 GNSS / 雨量等
- `HTTP或者TCP数据推送接口.pdf`：平台主动 HTTP POST 推送到本机接口

## 启动

```bash
cd sensor_bridge
python gateway.py
```

浏览器也可配合 Vite 前端：

```bash
# 另开终端
cd frontend
npm run dev
# → http://127.0.0.1:5174/  （/api 代理到本网关 5173）
```

仅网关托管页面时打开：http://127.0.0.1:5173/  
生产构建后可将 `config.json` 的 `staticDir` 改为 `../frontend/dist`。

## 关键参数（勿缩短）

| 项 | 值 | 说明 |
|----|----|------|
| 前端读取间隔 | **30 秒** | `/api/sensors/latest`、`/api/slope` |
| MQTT keepalive | **60 秒** | 心跳，禁止设太短 |
| MQTT 断线重连 | **30 秒** | 避免频繁重连 |

可在 `config.json` 修改；网关会强制 keepalive ≥ 30s、轮询建议 30s。

## 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/push` 或 `/` | 接收平台 HTTP JSON 推送 |
| GET | `/api/sensors/latest` | 环境+边坡+状态（前端主用） |
| GET | `/api/environment` | 环境点位 |
| GET | `/api/slope` | GNSS/雨量；无实时时回退 `frontend/data/slope.json` |
| GET | `/api/status` | MQTT/推送连接状态 |
| GET | `/api/sensors` | 原始汇聚快照 |
| GET | `/api/config` | 读取当前 `config.json`（后台管理用） |
| PUT | `/api/config` | 合并写入 `config.json`（MQTT 建议重启网关后生效） |

## 模拟推送

```bash
python simulate_http_push.py
```

## 设备映射

在 `config.json` 中配置：

- `environmentStations[].clientIds` / `deviceSns`：绑定 HTTP 推送的 `clientId` 或设备 SN
- `slopeDevices`：MQTT `deviceSn` → 边坡点位 id

未配置映射时：环境按最近推送自动填充最多 3 个点位；边坡展示所有收到的 GNSS/雨量。

## MQTT

默认连接文档示例：

- Host: `47.97.123.197:1883`
- User: `mqtt_test` / `test1234`
- Topic: `#`（可改为实际发布主题）

若公网 MQTT 不可达，网关会每 30 秒重试；前端仍可用本地快照 + HTTP 推送。
