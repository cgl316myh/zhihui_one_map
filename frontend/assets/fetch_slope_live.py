"""Login to wtapi.jgtop1.com and export slope snapshot for local frontend."""
from __future__ import annotations

import base64
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

BASE = "http://wtapi.jgtop1.com"
ACCOUNT = "15925118626"
PASSWORD = "228218494@qq.com"
OUT = Path(__file__).resolve().parents[1] / "data" / "slope.json"
CAP_OUT = Path(__file__).resolve().parent / "cap_from_api.png"

TZ = timezone(timedelta(hours=8))


def req(method: str, path: str, data=None, headers=None, cookie=""):
    url = BASE + path if path.startswith("/") else path
    body = None
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
    if data is not None:
        if isinstance(data, (dict, list)):
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            hdrs.setdefault("Content-Type", "application/json;charset=UTF-8")
        else:
            body = str(data).encode("utf-8")
    request = urllib.request.Request(url, data=body, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as resp:
            raw = resp.read()
            set_cookie = resp.headers.get_all("Set-Cookie") or []
            return resp.status, raw, set_cookie, dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), [], {}


def parse_set_cookie(set_cookies):
    parts = []
    for sc in set_cookies:
        parts.append(sc.split(";", 1)[0])
    return "; ".join(parts)


def solve_math_captcha(img_bytes: bytes) -> str | None:
    """Very small OCR for 'a [+x-] b = ?' style captchas using digit templates is hard;
    try reading with optional deps; otherwise return None."""
    CAP_OUT.write_bytes(img_bytes)
    try:
        from PIL import Image
        import pytesseract

        img = Image.open(CAP_OUT)
        text = pytesseract.image_to_string(img, config="--psm 7")
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
    except Exception as e:
        print("ocr fail", e)
    return None


def get_code():
    status, raw, set_cookies, headers = req("GET", "/auth/code")
    cookie = parse_set_cookie(set_cookies)
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception:
        print("code raw", raw[:200])
        raise
    print("code status", status, "keys", list(data.keys()) if isinstance(data, dict) else type(data))
    return data, cookie


def try_login(code: str, uuid: str, cookie: str):
    payloads = [
        {"username": ACCOUNT, "password": PASSWORD, "code": code, "uuid": uuid},
        {"username": ACCOUNT, "password": PASSWORD, "code": code, "uuid": uuid, "rememberMe": True},
        {"account": ACCOUNT, "password": PASSWORD, "code": code, "uuid": uuid},
        {"userName": ACCOUNT, "password": PASSWORD, "code": code, "uuid": uuid},
    ]
    paths = ["/auth/login", "/login", "/api/login", "/auth/userLogin"]
    for path in paths:
        for payload in payloads:
            status, raw, set_cookies, _ = req(
                "POST", path, data=payload, cookie=cookie
            )
            text = raw.decode("utf-8", "ignore")
            print("login try", path, status, text[:180].replace("\n", " "))
            if status == 200:
                try:
                    data = json.loads(text)
                except Exception:
                    continue
                token = None
                if isinstance(data, dict):
                    token = (
                        data.get("token")
                        or data.get("access_token")
                        or (data.get("data") or {}).get("token")
                        if isinstance(data.get("data"), dict)
                        else None
                    )
                    if data.get("code") in (0, 200, "0", "200") or token:
                        new_cookie = parse_set_cookie(set_cookies)
                        return data, token, (new_cookie or cookie)
    return None, None, cookie


def main():
    data, cookie = get_code()
    # common shapes: {img, uuid} or {data:{img,uuid}}
    payload = data.get("data", data) if isinstance(data, dict) else {}
    img_b64 = payload.get("img") or payload.get("image") or payload.get("captcha") or data.get("img")
    uuid = payload.get("uuid") or payload.get("key") or data.get("uuid")
    if not img_b64:
        print("unexpected code payload", json.dumps(data, ensure_ascii=False)[:500])
        return
    if "," in img_b64:
        img_b64 = img_b64.split(",", 1)[1]
    img_bytes = base64.b64decode(img_b64)
    CAP_OUT.write_bytes(img_bytes)
    print("saved captcha", CAP_OUT, "uuid", uuid)

    code = solve_math_captcha(img_bytes)
    if not code:
        print("NEED_MANUAL_CAPTCHA", CAP_OUT)
        # still leave artifact; frontend uses existing slope.json snapshot
        return

    login_data, token, cookie = try_login(code, uuid or "", cookie)
    print("login result token", bool(token), "data", str(login_data)[:300])
    if not token and not login_data:
        return

    auth_headers = {}
    if token:
        auth_headers["Authorization"] = f"Bearer {token}"
        auth_headers["token"] = token

    # probe data endpoints
    probes = [
        "/api/basicPoint/getDataType",
        "/pointlist",
        "/api/point/list",
        "/api/device/list",
        "/api/project/list",
        "/api/monitor/realtime",
        "/api/warn/list",
    ]
    for path in probes:
        status, raw, _, _ = req("GET", path, headers=auth_headers, cookie=cookie)
        print("probe", path, status, raw[:160])


if __name__ == "__main__":
    main()
