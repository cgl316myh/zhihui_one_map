前端静态资源（开发真源）。

日常改页面/脚本请直接改本目录（js/、css/、*.html），然后在 IDEA 重启后端即可生效。
Maven 默认已 skip.frontend=true，不会覆盖本目录。

访问示例（端口以 application-dev 为准，常见 8081）：
  http://127.0.0.1:8081/index.html
  http://127.0.0.1:8081/admin.html
