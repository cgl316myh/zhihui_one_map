"""Fetch GNSS chart-like series via discovered APIs."""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

TOKEN = Path(__file__).with_name("_token.txt").read_text(encoding="utf-8").strip()
BASE = "http://wtapi.jgtop1.com"
OUT = Path(__file__).resolve().parents[1] / "data" / "raw"
OUT.mkdir(parents=True, exist_ok=True)

H = {
    "Authorization": TOKEN,
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/plain, */*",
    "Origin": "http://bdlx.jgtop1.com",
    "Referer": "http://bdlx.jgtop1.com/",
    "Content-Type": "application/json;charset=UTF-8",
}

POINTS = [
    {"id": 5759, "name": "25038478(堆石平台)", "sn": "17625038478"},
    {"id": 5760, "name": "25038476(堆石平台)", "sn": "17625038476"},
    {"id": 5761, "name": "25038475(禁采区)", "sn": "17625038475"},
    {"id": 5762, "name": "雨量", "sn": "17525030953"},
]


def req(method: str, path: str, data=None, params=None):
    url = BASE + path
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params, doseq=True)
    body = None
    headers = dict(H)
    if data is not None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as resp:
            raw = resp.read()
            ctype = resp.headers.get("Content-Type", "")
            print("OK", method, path, resp.status, ctype, len(raw))
            return resp.status, raw, ctype
    except urllib.error.HTTPError as e:
        raw = e.read()
        print("ER", method, path, e.code, raw[:240])
        return e.code, raw, ""


def main():
    # Date format attempts for exportExcel
    date_pairs = [
        ("2026-06-25T01:00:00", "2026-07-15T01:00:00"),
        ("2026-06-25T01:00:00.000Z", "2026-07-15T01:00:00.000Z"),
        ("2026-06-25", "2026-07-15"),
    ]
    id_list = [5759, 5760, 5761]
    for start, end in date_pairs:
        for key_start, key_end in [
            ("startTime", "endTime"),
            ("beginTime", "endTime"),
            ("start", "end"),
            ("begin", "end"),
        ]:
            for id_key in ("ids", "pointIds", "idList", "pointIdList"):
                payload = {id_key: id_list, key_start: start, key_end: end, "type": "TXtData"}
                status, raw, ctype = req("POST", "/api/basicPoint/exportExcel", data=payload)
                if status == 200 and raw:
                    name = f"export_{id_key}_{key_start}_{start[:10]}.bin"
                    (OUT / name).write_bytes(raw)
                    print("saved", name)
                    # if excel/csv text
                    try:
                        text = raw.decode("utf-8")
                        (OUT / (name + ".txt")).write_text(text[:5000], encoding="utf-8")
                    except Exception:
                        pass
                    return

    # probe device data endpoints
    probes = [
        ("GET", "/api/device/data", None, {"id": 5759, "snType": "TXtData"}),
        ("GET", "/api/device/data", None, {"pointId": 5759}),
        ("POST", "/api/device/data", {"id": 5759, "snType": "TXtData"}, None),
        (
            "GET",
            "/api/device/data",
            None,
            {
                "id": 5759,
                "snType": "TXtData",
                "startTime": "2026-06-25T01:00:00",
                "endTime": "2026-07-15T01:00:00",
            },
        ),
        ("GET", "/api/basicMonitor/all", None, {}),
        ("GET", "/api/basicPoint", None, {"page": 0, "size": 50}),
    ]
    for method, path, data, params in probes:
        status, raw, ctype = req(method, path, data=data, params=params)
        if status == 200 and raw:
            fname = path.strip("/").replace("/", "_") + ".json"
            try:
                obj = json.loads(raw.decode("utf-8"))
                (OUT / fname).write_text(
                    json.dumps(obj, ensure_ascii=False, indent=2)[:200000],
                    encoding="utf-8",
                )
                print("json keys", list(obj)[:10] if isinstance(obj, dict) else type(obj))
            except Exception:
                (OUT / (fname + ".bin")).write_bytes(raw[:200000])


if __name__ == "__main__":
    main()
