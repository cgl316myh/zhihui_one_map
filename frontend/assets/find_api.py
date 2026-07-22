"""Discover history data API from frontend assets / probe common patterns."""
from __future__ import annotations

import json
import re
import urllib.request
from pathlib import Path

TOKEN = open(Path(__file__).with_name("_token.txt"), encoding="utf-8").read().strip()
BASE = "http://wtapi.jgtop1.com"
FRONT = "http://bdlx.jgtop1.com"
HEADERS = {
    "Authorization": TOKEN,
    "User-Agent": "Mozilla/5.0",
    "Accept": "*/*",
    "Origin": FRONT,
    "Referer": FRONT + "/",
}


def get(url: str, headers=None) -> bytes:
    req = urllib.request.Request(url, headers=headers or HEADERS)
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read()


def main():
    html = get(FRONT + "/").decode("utf-8", "ignore")
    Path(__file__).with_name("_index.html").write_text(html, encoding="utf-8")
    js_urls = re.findall(r'src=["\']([^"\']+\.js)["\']', html)
    print("js", len(js_urls))
    blob = html
    for u in js_urls:
        if u.startswith("//"):
            u = "http:" + u
        elif u.startswith("/"):
            u = FRONT + u
        elif not u.startswith("http"):
            u = FRONT + "/" + u
        try:
            blob += "\n" + get(u).decode("utf-8", "ignore")
            print("got", u, "len", len(blob))
        except Exception as e:
            print("fail", u, e)

    # also try static/js common chunks
    for path in [
        "/static/js/app.js",
        "/static/js/chunk-vendors.js",
        "/js/app.js",
        "/assets/index.js",
    ]:
        try:
            data = get(FRONT + path)
            blob += "\n" + data.decode("utf-8", "ignore")
            print("extra", path, len(data))
        except Exception as e:
            print("no", path, e)

    Path(__file__).with_name("_front_bundle.txt").write_text(blob[:5_000_000], encoding="utf-8")
    patterns = [
        r"/api/[A-Za-z0-9_/\-{}]+",
        r"TXtData|txtData|historyData|multiParam|planeDisplacement|累计平面",
        r"getData|queryData|chartData|analysisData",
    ]
    hits = set()
    for p in patterns:
        for m in re.findall(p, blob):
            hits.add(m)
    for h in sorted(hits):
        if "api" in h.lower() or "Data" in h or "data" in h:
            print("HIT", h)


if __name__ == "__main__":
    main()
