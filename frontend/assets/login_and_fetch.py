"""Login slope monitor API and probe data-analysis endpoints."""
from __future__ import annotations

import base64
import hashlib
import json
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "http://wtapi.jgtop1.com"
ACC = "15925118626"
PWD = "228218494@qq.com"
OUT_DIR = Path(__file__).resolve().parent


def http(method: str, path: str, data=None, headers=None, cookie: str = ""):
    url = path if path.startswith("http") else BASE + path
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
            sc = resp.headers.get_all("Set-Cookie") or []
            cookie_str = "; ".join(c.split(";", 1)[0] for c in sc)
            return resp.status, raw, cookie_str
    except urllib.error.HTTPError as e:
        return e.code, e.read(), ""


def get_code():
    st, raw, cookie = http("GET", "/auth/code")
    data = json.loads(raw.decode("utf-8"))
    img = data.get("img")
    uuid = data.get("uuid")
    if img and "," in img:
        img = img.split(",", 1)[1]
    if img:
        (OUT_DIR / "cap_login.png").write_bytes(base64.b64decode(img))
    return uuid, cookie, data


def try_login(code: str, uuid: str, cookie: str = ""):
    variants = [
        {"username": ACC, "password": PWD, "code": code, "uuid": uuid},
        {
            "username": ACC,
            "password": base64.b64encode(PWD.encode()).decode(),
            "code": code,
            "uuid": uuid,
        },
        {
            "username": ACC,
            "password": hashlib.md5(PWD.encode()).hexdigest(),
            "code": code,
            "uuid": uuid,
        },
        {"userName": ACC, "password": PWD, "code": code, "uuid": uuid},
        {
            "username": ACC,
            "password": PWD,
            "code": code,
            "uuid": uuid,
            "rememberMe": True,
        },
    ]
    paths = ["/auth/login", "/login", "/auth/userLogin", "/api/auth/login"]
    for path in paths:
        for i, payload in enumerate(variants):
            st, raw, new_cookie = http("POST", path, payload, cookie=cookie)
            text = raw.decode("utf-8", "ignore")
            print(f"login {path}#{i} -> {st} {text[:200]}")
            if st != 200:
                continue
            try:
                data = json.loads(text)
            except Exception:
                continue
            token = None
            if isinstance(data, dict):
                token = data.get("token")
                if not token and isinstance(data.get("data"), dict):
                    token = data["data"].get("token") or data["data"].get("access_token")
                code_ok = data.get("code") in (0, 200, "0", "200")
                if token or code_ok:
                    return data, token, new_cookie or cookie
    return None, None, cookie


def probe(token: str, cookie: str = ""):
    auth = {"Authorization": f"Bearer {token}", "token": token}
    point_ids = ["25038478", "25038476", "25038475"]
    start = "2026-06-25 01:03:08"
    end = "2026-07-15 01:03:08"
    probes = [
        ("GET", "/getInfo", None),
        ("GET", "/system/user/getInfo", None),
        ("GET", "/device/list", None),
        ("GET", "/monitor/device/list", None),
        ("GET", "/api/device/list", None),
        ("GET", "/basic/device/list", None),
        (
            "POST",
            "/analysis/data",
            {
                "deviceIds": point_ids,
                "startTime": start,
                "endTime": end,
                "type": "multi",
            },
        ),
        (
            "POST",
            "/data/analysis/list",
            {
                "ids": point_ids,
                "beginTime": start,
                "endTime": end,
            },
        ),
        (
            "POST",
            "/gnss/query",
            {
                "pointIds": point_ids,
                "startTime": start,
                "endTime": end,
            },
        ),
    ]
    for method, path, body in probes:
        st, raw, _ = http(method, path, body, headers=auth, cookie=cookie)
        text = raw.decode("utf-8", "ignore")
        print(f"probe {method} {path} -> {st} {text[:180]}")
        if st == 200 and len(text) > 20:
            out = OUT_DIR / f"probe_{path.strip('/').replace('/', '_')}.json"
            out.write_text(text, encoding="utf-8")
            print("  saved", out)


def main():
    import sys

    if len(sys.argv) < 2:
        uuid, cookie, data = get_code()
        print("CAPTCHA saved to", OUT_DIR / "cap_login.png")
        print("uuid=", uuid)
        print("Solve captcha then: python login_and_fetch.py <answer>")
        return 2

    code = sys.argv[1]
    # Prefer uuid from argv2 if provided, else refresh (won't work with old code)
    if len(sys.argv) >= 3:
        uuid = sys.argv[2]
        cookie = ""
    else:
        # Use last printed uuid - user must pass it
        print("Need: python login_and_fetch.py <code> <uuid>")
        return 2

    login_data, token, cookie = try_login(code, uuid, cookie)
    print("token?", bool(token), "login_data keys", list(login_data.keys()) if login_data else None)
    if not token:
        return 1
    (OUT_DIR / "login_ok.json").write_text(
        json.dumps(login_data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    probe(token, cookie)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
