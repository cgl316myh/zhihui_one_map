from __future__ import annotations

import re
import urllib.request
from pathlib import Path

url = "http://userweb.jgtop1.com/js/app.1763535946512.js"
print("downloading...")
data = urllib.request.urlopen(url, timeout=90).read().decode("utf-8", "ignore")
out = Path(__file__).with_name("_app.js")
out.write_text(data, encoding="utf-8")
print("size", len(data))

for key in [
    "TXtData",
    "queryData",
    "getHistory",
    "historyData",
    "planeDisplacement",
    "累计平面",
    "multiParam",
    "getChart",
    "analy",
]:
    idx = data.find(key)
    print("---", key, "first", idx)
    if idx >= 0:
        snippet = data[max(0, idx - 160) : idx + 240].replace("\n", " ")
        print(snippet[:400])

apis = sorted(set(re.findall(r"['\"](/api/[A-Za-z0-9_/\-]+)['\"]", data)))
print("api count", len(apis))
for a in apis:
    low = a.lower()
    if any(
        k in low
        for k in [
            "data",
            "point",
            "gnss",
            "txt",
            "chart",
            "analy",
            "history",
            "rain",
            "yl",
            "graphic",
        ]
    ):
        print(a)
