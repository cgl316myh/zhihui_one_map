#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""云端 HTTP 推送中转：接收厂商推送，保留约 24h，供内网拉取。

依赖：仅标准库。启动：
  python app.py
环境变量：
  RELAY_PORT=8787
  RELAY_TOKEN=可选共享密钥
  RELAY_HOURS=24
  RELAY_DB=relay.sqlite
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

PORT = int(os.environ.get("RELAY_PORT", "8787"))
TOKEN = os.environ.get("RELAY_TOKEN", "").strip()
HOURS = max(1, int(os.environ.get("RELAY_HOURS", "24")))
DB_PATH = os.environ.get("RELAY_DB", os.path.join(os.path.dirname(__file__), "relay.sqlite"))
TZ8 = timezone(timedelta(hours=8))
_lock = threading.Lock()


def now_iso() -> str:
    return datetime.now(TZ8).isoformat()


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS push_msg (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          client_id TEXT NOT NULL,
          payload TEXT NOT NULL,
          received_at TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_push_time ON push_msg(received_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_push_client ON push_msg(client_id, received_at)")
    return conn


CONN = db()


def prune(conn: sqlite3.Connection) -> None:
    cutoff = (datetime.now(TZ8) - timedelta(hours=HOURS)).isoformat()
    conn.execute("DELETE FROM push_msg WHERE received_at < ?", (cutoff,))
    conn.commit()


def auth_ok(handler: BaseHTTPRequestHandler) -> bool:
    if not TOKEN:
        return True
    auth = handler.headers.get("Authorization", "")
    if auth.startswith("Bearer ") and auth[7:].strip() == TOKEN:
        return True
    if handler.headers.get("X-Push-Token", "").strip() == TOKEN:
        return True
    return False


def read_json(handler: BaseHTTPRequestHandler):
    length = int(handler.headers.get("Content-Length") or 0)
    raw = handler.rfile.read(length) if length else b"{}"
    return json.loads(raw.decode("utf-8") or "{}")


def write_json(handler: BaseHTTPRequestHandler, code: int, obj) -> None:
    body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print("[%s] %s" % (now_iso(), fmt % args))

    def do_GET(self):
        if not auth_ok(self):
            write_json(self, 401, {"ok": False, "message": "unauthorized"})
            return
        path = urlparse(self.path).path
        qs = parse_qs(urlparse(self.path).query)
        with _lock:
            prune(CONN)
            if path == "/api/relay/health":
                n = CONN.execute("SELECT COUNT(*) FROM push_msg").fetchone()[0]
                write_json(self, 200, {"ok": True, "count": n, "retentionHours": HOURS, "at": now_iso()})
                return
            if path == "/api/relay/latest":
                rows = CONN.execute(
                    """
                    SELECT client_id, payload, received_at FROM push_msg m
                    WHERE id = (
                      SELECT id FROM push_msg t WHERE t.client_id = m.client_id
                      ORDER BY received_at DESC, id DESC LIMIT 1
                    )
                    ORDER BY received_at DESC
                    """
                ).fetchall()
                items = []
                for _cid, payload, _at in rows:
                    try:
                        items.append(json.loads(payload))
                    except Exception:
                        pass
                write_json(self, 200, items)
                return
            if path == "/api/relay/since":
                t = (qs.get("t") or [""])[0]
                rows = CONN.execute(
                    """
                    SELECT payload FROM push_msg
                    WHERE received_at > ?
                    ORDER BY received_at ASC, id ASC
                    LIMIT 5000
                    """,
                    (t,),
                ).fetchall()
                items = []
                for (payload,) in rows:
                    try:
                        items.append(json.loads(payload))
                    except Exception:
                        pass
                write_json(self, 200, {"items": items, "count": len(items)})
                return
        write_json(self, 404, {"ok": False, "message": "not found"})

    def do_POST(self):
        if not auth_ok(self):
            write_json(self, 401, {"ok": False, "message": "unauthorized"})
            return
        path = urlparse(self.path).path
        if path not in ("/api/push", "/"):
            write_json(self, 404, {"ok": False, "message": "not found"})
            return
        try:
            data = read_json(self)
        except Exception as e:
            write_json(self, 400, {"ok": False, "message": str(e)})
            return
        if not isinstance(data, dict):
            write_json(self, 400, {"ok": False, "message": "object required"})
            return
        client_id = str(data.get("clientId") or data.get("deviceSn") or "unknown")
        at = now_iso()
        with _lock:
            CONN.execute(
                "INSERT INTO push_msg(client_id, payload, received_at) VALUES (?,?,?)",
                (client_id, json.dumps(data, ensure_ascii=False), at),
            )
            prune(CONN)
            CONN.commit()
        write_json(self, 200, {"ok": True, "receivedAt": at, "clientId": client_id})


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print("cloud_relay listening on 0.0.0.0:%s db=%s hours=%s" % (PORT, DB_PATH, HOURS))
    server.serve_forever()


if __name__ == "__main__":
    main()
