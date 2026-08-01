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

## 一键只启 backend（推荐）

前端会在构建期打入 `classpath:/static/`，**只需一个终端**：

```powershell
cd src\backend
.\run.ps1
```

或：

```bash
cd src/backend
mvn spring-boot:run
```

（`mvn spring-boot:run` 会通过 `frontend-maven-plugin` 构建 `../frontend` 并拷贝到 `target/classes/static`。）

启动后打开：

| 页面 | 地址 |
|------|------|
| 登录 | http://127.0.0.1:8081/ （dev 默认；可用 `SERVER_PORT` 覆盖） |
| 一张图 | http://127.0.0.1:8081/index.html |
| 管理后台 | http://127.0.0.1:8081/admin.html |

默认账号：`admin` / `123456`，`user` / `123456`。

### 跳过前端构建（仅 API）

```bash
mvn spring-boot:run -Dskip.frontend=true
# 或
.\run.ps1 -SkipFrontend
```

### 前端热更新开发（双终端，可选）

```bash
# 终端1
cd src/backend && mvn spring-boot:run -Dskip.frontend=true

# 终端2
cd src/frontend && npm run dev   # http://127.0.0.1:5174 ，/api 代理到 8081
```

## 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `SPRING_PROFILES_ACTIVE` | 配置 | `dev` |
| `DB_PASSWORD` | postgres 用户密码 | `postgres` |
| `JWT_SECRET` | JWT 密钥（≥32 字节） | 见 `application.yml` |
| `BRIDGE_BASE_URL` | sensor_bridge | `http://127.0.0.1:5173` |
| `SERVER_PORT` | 端口 | dev 默认 `8081`（避免本机 IIS 占 8080） |
| `skip.frontend` | 跳过前端构建 | `false` |

## 主要接口

- 认证：`POST /api/auth/login|register|refresh`，`GET /api/auth/me`
- 大屏：`GET /api/environment|slope|production|video|reserves|alerts|sensors/latest|config/public`
- 管理（需 `ROLE_ADMIN`）：`/api/admin/**`

统一响应：`{ "code": 0, "message": "ok", "data": ... }`

## 种子数据

`src/main/resources/seed/`：配置表 payload 为空时自动导入；视频点位在空表时从 `video.json` 导入。
