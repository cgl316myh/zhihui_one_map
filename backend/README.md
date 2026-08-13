# mine-one-map-api

智慧矿山一张图 · Spring Boot 3.3 后端（含前端静态托管）。

## 环境要求

- JDK 17+
- Maven 3.9+
- PostgreSQL 14+
- Node.js 18+（一键构建前端时需要；也可用 Maven 内置下载的 Node）

## 数据库

开发环境直接用 **`postgres` 超级用户**（不单独建业务账号）。

1. 用 `postgres` 建库（若已有可跳过）：

```sql
CREATE DATABASE zhihui_one_map OWNER postgres ENCODING 'UTF8';
```

2. 连接配置见 `application-dev.yml`：

| 项 | 值 |
|----|-----|
| 库名 | `zhihui_one_map` |
| 用户 | `postgres` |
| 密码 | 默认 `postgres`，可用环境变量 `DB_PASSWORD` 覆盖为你本机 postgres 密码 |

若库结构混乱，可用 `postgres` 清空后重跑 Flyway：

```sql
\c zhihui_one_map
DROP SCHEMA public CASCADE;
CREATE SCHEMA public AUTHORIZATION postgres;
```

Flyway 启动时执行 `db/migration/V1__init_tables.sql`。

## 前端静态资源（日常改这里）

**真源目录**：`src/backend/src/main/resources/static/`（`js/`、`css/`、`*.html`）。

| 操作 | 说明 |
|------|------|
| 改页面/脚本 | 直接改 `static/` 下文件 |
| 看效果 | IDEA **重启**后端，打开 http://127.0.0.1:8081/admin.html |

Maven 默认 `skip.frontend=true`，构建不会覆盖 `static/`。

## 一键只启 backend（推荐）

```powershell
cd src\backend
.\run.ps1
```

或 IDEA 直接运行 `MineOneMapApplication`。

启动后打开：

| 页面 | 地址 |
|------|------|
| 登录 | http://127.0.0.1:8081/ （dev 默认；可用 `SERVER_PORT` 覆盖） |
| 一张图 | http://127.0.0.1:8081/index.html |
| 管理后台 | http://127.0.0.1:8081/admin.html |

默认账号：`admin` / `123456`，`user` / `123456`。

## 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `SPRING_PROFILES_ACTIVE` | 配置 | `dev` |
| `DB_PASSWORD` | postgres 用户密码 | `postgres` |
| `JWT_SECRET` | JWT 密钥（≥32 字节） | 见 `application.yml` |
| `SERVER_PORT` | 端口 | dev 默认 `8081`（避免本机 IIS 占 8080） |
| `skip.frontend` | 跳过前端构建（保持 true） | `true` |

## 传感器接入（内置，无需 Python）

MQTT 订阅与 HTTP 推送已并入本服务，**部署服务器不必再装 Python / 不必启动 `sensor_bridge`**。

| 能力 | 说明 |
|------|------|
| HTTP 推送 | `POST /api/push`（无需 JWT），JSON 对象或数组 |
| MQTT | 启动时按 `cfg_sensor_bridge` 连接；后台改配置后自动重连 |
| 大屏读数 | `GET /api/environment`、`/api/slope`、`/api/sensors/latest` 读内存最新值 |
| 状态 | `GET /api/sensors/status`（需登录） |

配置在库表 `cfg_sensor_bridge`（管理后台「数据接入」）：`ingest.enabled`（接收总开关）、`mqtt`、`environmentStations`、`slopeDevices`、`thresholds`。

推送数据持久化到 PostgreSQL：

| 表 | 用途 |
|----|------|
| `biz_sensor_latest` | 每设备最新一条（重启后回填内存） |
| `biz_sensor_event` | 全量流水 |
| `ts_env_sample` / `ts_slope_sample` | 环境指标 / 边坡位移时序 |

旧 Python 网关可保留作对照，生产路径以本服务为准。

## 主要接口

- 认证：`POST /api/auth/login|register|refresh`，`GET /api/auth/me`
- 大屏：`GET /api/environment|slope|production|video|reserves|alerts|sensors/latest|config/public`
- 推送：`POST /api/push`（公开）
- 管理（需 `ROLE_ADMIN`）：`/api/admin/**`

统一响应：`{ "code": 0, "message": "ok", "data": ... }`（`/api/push` 除外，返回 `{ ok, receivedAt }`）

## 种子数据

`src/main/resources/seed/`：配置表 payload 为空时自动导入；视频点位在空表时从 `video.json` 导入。
