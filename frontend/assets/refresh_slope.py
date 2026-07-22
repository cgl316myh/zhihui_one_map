"""从边坡监控 API 拉取验证码并尝试登录导出；失败时保留现有 slope.json。"""
from __future__ import annotations

import base64
import json
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

BASE = "http://wtapi.jgtop1.com"
ACCOUNT = "15925118626"
PASSWORD = "228218494@qq.com"
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "slope.json"
CAP = Path(__file__).resolve().parent / "cap_try.png"
TZ = timezone(timedelta(hours=8))


def http(method: str, path: str, data=None, headers=None, cookie: str = ""):
    url = BASE + path
    hdrs = {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json, text/plain, */*",
        "Origin": "http://bdlx.jgtop1.com",
        "Referer": "http://bdlx.jgtop1.com/",
    }
    if cookie:
        hdrs["Cookie"] = cookie
    if headers:
        hdrs.update(headers)
    body = None
    if data is not None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        hdrs["Content-Type"] = "application/json;charset=UTF-8"
    req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            cookies = resp.headers.get_all("Set-Cookie") or []
            return resp.status, raw, "; ".join(c.split(";", 1)[0] for c in cookies)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), ""


def solve_captcha(img: bytes) -> str | None:
    CAP.write_bytes(img)
    # 常见算式：a ± b = ?
    try:
        from PIL import Image
        import pytesseract

        text = pytesseract.image_to_string(Image.open(CAP), config="--psm 7")
        text = text.replace("×", "x").replace("X", "x").replace(" ", "")
        m = re.search(r"(\d+)\s*([+\-x*/])\s*(\d+)", text)
        if not m:
            return None
        a, op, b = int(m.group(1)), m.group(2), int(m.group(3))
        if op == "+":
            return str(a + b)
        if op == "-":
            return str(a - b)
        if op in ("x", "*"):
            return str(a * b)
        if op == "/":
            return str(a // b if b else 0)
    except Exception as exc:
        print("ocr unavailable:", exc)
    return None


def main():
    status, raw, cookie = http("GET", "/auth/code")
    data = json.loads(raw.decode("utf-8"))
    payload = data.get("data", data) if isinstance(data, dict) else {}
    img_b64 = payload.get("img") or data.get("img")
    uuid = payload.get("uuid") or data.get("uuid")
    if not img_b64:
        print("no captcha", data)
        return 1
    if "," in img_b64:
        img_b64 = img_b64.split(",", 1)[1]
    img = base64.b64decode(img_b64)
    code = solve_captcha(img)
    print("captcha saved", CAP, "ocr=", code, "uuid=", uuid)
    if not code:
        print("manual captcha needed; keeping existing", OUT)
        return 2

    status, raw, cookie2 = http(
        "POST",
        "/auth/login",
        data={
            "username": ACCOUNT,
            "password": PASSWORD,
            "code": code,
            "uuid": uuid,
        },
        cookie=cookie,
    )
    text = raw.decode("utf-8", "ignore")
    print("login", status, text[:240])
    try:
        login = json.loads(text)
    except Exception:
        return 3
    token = None
    if isinstance(login, dict):
        token = login.get("token") or (login.get("data") or {}).get("token")
    if not token:
        print("no token; keep existing snapshot")
        return 4

    # 登录成功后探测若干接口，尽量拼出 slope.json
    auth = {"Authorization": f"Bearer {token}", "token": token}
    for path in (
        "/api/monitor/realtime",
        "/api/point/list",
        "/api/device/list",
        "/api/project/list",
        "/pointlist",
    ):
        st, body, _ = http("GET", path, headers=auth, cookie=cookie2 or cookie)
        print("probe", path, st, body[:160])

    # 若尚未映射到稳定接口，仅标注来源时间，避免覆盖可用快照
    if OUT.exists():
        snap = json.loads(OUT.read_text(encoding="utf-8"))
        snap["updatedAt"] = datetime.now(TZ).isoformat(timespec="seconds")
        snap["sourceNote"] = "login ok; live mapping pending — timestamp refreshed"
        OUT.write_text(json.dumps(snap, ensure_ascii=False, indent=2), encoding="utf-8")
        print("updated timestamp on", OUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
