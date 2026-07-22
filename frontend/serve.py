"""兼容入口（无 Vite 时的纯静态服务）。

推荐开发方式：
    cd frontend
    npm install
    npm run dev
    # → http://127.0.0.1:5174  （/api 代理到网关 5173）

传感器网关（另开终端）：
    python ../sensor_bridge/gateway.py
"""
from __future__ import annotations

import http.server
import socketserver

PORT = 5175


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **getattr(http.server.SimpleHTTPRequestHandler, "extensions_map", {}),
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".css": "text/css",
        ".html": "text/html",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".svg": "image/svg+xml",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    print("提示: 推荐使用  npm run dev  （Vite :5174）", flush=True)
    print("本脚本为无 Node 时的静态兜底，端口", PORT, flush=True)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
        print(f"Serving static only http://127.0.0.1:{PORT}", flush=True)
        httpd.serve_forever()
