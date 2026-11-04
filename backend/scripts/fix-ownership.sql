-- 已改为使用 postgres 用户连接，一般无需本脚本。
-- 若库中仍有其它属主对象，用 postgres 登录执行即可（超级用户可操作全部对象）。

-- 开发环境推荐干净重来：
-- DROP SCHEMA public CASCADE;
-- CREATE SCHEMA public AUTHORIZATION postgres;
