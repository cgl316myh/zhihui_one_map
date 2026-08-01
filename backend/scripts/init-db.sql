-- 用 postgres 超级用户执行（不单独建业务用户）
-- psql -U postgres -f init-db.sql

SELECT 'CREATE DATABASE zhihui_one_map OWNER postgres ENCODING ''UTF8'''
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'zhihui_one_map')\gexec

\c zhihui_one_map

-- 开发环境可选：清空后由 Flyway 重建
-- DROP SCHEMA public CASCADE;
-- CREATE SCHEMA public AUTHORIZATION postgres;
