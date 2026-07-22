"""Login and pull GNSS + rainfall history into slope.json."""
from __future__ import annotations

import base64
import json
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

BASE = "http://wtapi.jgtop1.com"
ACCOUNT = "15925118626"
PASSWORD = "228218494@qq.com"
ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
RAW.mkdir(parents=True, exist_ok=True)
TZ = timezone(timedelta(hours=8))

# GNSS + rain point ids from /api/basicPoint
GNSS_IDS = [5759, 5760, 5761]
RAIN_IDS = [5762]
START = "2026-06-25 01:03:08"
END = "2026-07-15 01:03:08"


def http(method: str, path: str, data=None, headers=None, cookie: str = ""):
    url = BASE + path if path.startswith("/") else path
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
        hdrs.setdefault("Content-Type", "application/json;charset=UTF-8")
    req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read()
            sc = resp.headers.get_all("Set-Cookie") or []
            cookie2 = "; ".join(c.split(";", 1)[0] for c in sc)
            return resp.status, raw, cookie2 or cookie
    except urllib.error.HTTPError as e:
        return e.code, e.read(), cookie


def login_with_code(code: str, uuid: str, cookie: str = ""):
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
    print("login", status, text[:200])
    data = json.loads(text)
    token = data.get("token") or (data.get("data") or {}).get("token")
    if token and not str(token).startswith("Bearer"):
        token = "Bearer " + token
    return token, cookie2


def get_history(token: str, ids: list[int]) -> dict:
    auth = {"Authorization": token}
    payload = {"ids": ids, "startTime": START, "endTime": END}
    status, raw, _ = http(
        "POST", "/api/analysis/getHistoryData", data=payload, headers=auth
    )
    print("getHistoryData", ids, status, len(raw))
    if status != 200:
        raise RuntimeError(raw.decode("utf-8", "ignore")[:300])
    return json.loads(raw.decode("utf-8"))


def ensure_token() -> str:
    token_path = Path(__file__).with_name("_token.txt")
    if token_path.exists():
        token = token_path.read_text(encoding="utf-8").strip()
        try:
            get_history(token, GNSS_IDS[:1])
            return token
        except Exception as e:
            print("token stale:", e)

    status, raw, cookie = http("GET", "/auth/code")
    code_data = json.loads(raw.decode("utf-8"))
    img = code_data.get("img")
    uuid = code_data.get("uuid")
    if img and "," in img:
        img = img.split(",", 1)[1]
    Path(__file__).with_name("cap_live.png").write_bytes(base64.b64decode(img))
    raise SystemExit(
        f"Need captcha login. Saved captcha to assets/cap_live.png uuid={uuid}. "
        "Login in browser or update _token.txt then re-run."
    )


def build_gnss_points(hist: dict, points_meta: dict) -> list:
    meta_by_name = {}
    for p in points_meta.get("points", []):
        meta_by_name[p["name"]] = p
        if "(" in p["name"]:
            meta_by_name[p["name"].split("(")[0]] = p

    out_points = []
    for key, series in hist.items():
        # skip rain keys like "雨量,201,5762"
        if ",201," in key or key.startswith("雨量"):
            continue
        name = key.split(",")[0]
        if not isinstance(series, list) or not series:
            continue
        rows = sorted(series, key=lambda r: r.get("calculatingTime") or "")
        last = rows[-1]
        step = max(1, len(rows) // 40)
        sampled = rows[::step]
        if sampled[-1] is not rows[-1]:
            sampled.append(rows[-1])

        plane = float(last.get("totalPlaneDisplacement") or 0)
        x = float(last.get("totalX") or 0)
        y = float(last.get("totalY") or 0)
        h = float(last.get("totalH") or 0)
        status = "normal"
        if abs(plane) >= 10 or abs(x) >= 10:
            status = "alarm"
        elif abs(plane) >= 5 or abs(x) >= 5:
            status = "warn"

        meta = meta_by_name.get(name) or {}
        out_points.append(
            {
                "id": meta.get("id") or last.get("devId") or name,
                "name": name,
                "status": status,
                "x": round(x, 3),
                "y": round(y, 3),
                "h": round(h, 3),
                "plane": round(plane, 3),
                "unit": "mm",
                "threshold": {"warn": 5, "alarm": 10},
                "series": [
                    {
                        "t": r.get("calculatingTime"),
                        "x": float(r.get("totalX") or 0),
                        "y": float(r.get("totalY") or 0),
                        "h": float(r.get("totalH") or 0),
                        "plane": float(r.get("totalPlaneDisplacement") or 0),
                    }
                    for r in sampled
                ],
            }
        )
    return out_points


def build_rainfall(hist: dict, points_meta: dict) -> dict | None:
    rain_meta = next(
        (p for p in points_meta.get("points", []) if p.get("type") == "rainfall"),
        None,
    )
    series = None
    for key, arr in hist.items():
        if ",201," in key or key.startswith("雨量") or (rain_meta and rain_meta["id"] in key):
            series = arr
            break
    if not series:
        # hist may only be rain response
        if len(hist) == 1:
            series = next(iter(hist.values()))
    if not series:
        return None

    rows = sorted(series, key=lambda r: r.get("calculatingTime") or "")
    last = rows[-1]
    obs = [float(r.get("observation") or r.get("yl60f") or 0) for r in rows]
    current = float(last.get("observation") or last.get("yl60f") or 0)
    # prefer API total/yl24h if present on last row
    cumulative = float(last.get("total") or 0) or round(sum(obs), 1)
    yl24 = float(last.get("yl24h") or 0)
    status = "normal"
    if current >= 30 or yl24 >= 50:
        status = "alarm"
    elif current >= 10 or yl24 >= 25:
        status = "warn"

    step = max(1, len(rows) // 48)
    sampled = rows[::step]
    if sampled[-1] is not rows[-1]:
        sampled.append(rows[-1])

    return {
        "id": (rain_meta or {}).get("id") or "5762",
        "name": (rain_meta or {}).get("name") or "雨量",
        "valueMm": round(current, 1),
        "cumulativeMm": round(cumulative, 1),
        "yl24h": round(yl24, 1) if yl24 else None,
        "status": status,
        "unit": "mm",
        "updatedAt": last.get("calculatingTime"),
        "series": [
            {
                "t": r.get("calculatingTime"),
                "value": float(r.get("observation") or r.get("yl60f") or 0),
            }
            for r in sampled
        ],
    }


def main():
    token_path = Path(__file__).with_name("_token.txt")
    token = token_path.read_text(encoding="utf-8").strip()
    # probe token
    try:
        get_history(token, [5762])
    except Exception:
        token = ensure_token()

    gnss_hist = get_history(token, GNSS_IDS)
    rain_hist = get_history(token, RAIN_IDS)
    (RAW / "getHistoryData.json").write_text(
        json.dumps(gnss_hist, ensure_ascii=False), encoding="utf-8"
    )
    (RAW / "getHistoryData_rain.json").write_text(
        json.dumps(rain_hist, ensure_ascii=False), encoding="utf-8"
    )

    points_meta = json.loads(
        (ROOT / "data" / "slope-points.json").read_text(encoding="utf-8")
    )
    slope = {
        "updatedAt": datetime.now(TZ).isoformat(timespec="seconds"),
        "source": "安宁隆瑞采石场混泥土有限公司边坡位移监控系统",
        "sourceUrl": "http://bdlx.jgtop1.com/",
        "api": "POST /api/analysis/getHistoryData",
        "projectName": points_meta.get("project")
        or "安宁隆瑞混凝土有限责任公司采石场边坡位移监控系统",
        "range": {"startTime": START, "endTime": END},
        "rainfall": build_rainfall(rain_hist, points_meta),
        "points": build_gnss_points(gnss_hist, points_meta),
    }
    out = ROOT / "data" / "slope.json"
    out.write_text(json.dumps(slope, ensure_ascii=False, indent=2), encoding="utf-8")
    rain = slope["rainfall"] or {}
    print(
        "wrote",
        out,
        "gnss",
        len(slope["points"]),
        "rain current",
        rain.get("valueMm"),
        "cumul",
        rain.get("cumulativeMm"),
    )


if __name__ == "__main__":
    main()
