from __future__ import annotations

import re
from pathlib import Path

data = Path(__file__).with_name("_app.js").read_text(encoding="utf-8", errors="ignore")

keys = [
    "api/all",
    "all/api",
    "exportExcel",
    "basicPoint",
    "TXtData",
    "TResRain",
    "getPoint",
    "queryPoint",
    "getOriData",
    "oriData",
    "monitorData",
    "deviceData",
    "getSeries",
    "seriesData",
    "/api/graphic",
    "graphic?",
    "post)(\"/",
    "post)('/",
    "get)(\"/api",
    "get)('/api",
]

for key in keys:
    print("====", key)
    idx = 0
    n = 0
    while n < 8:
        i = data.find(key, idx)
        if i < 0:
            break
        print(data[max(0, i - 100) : i + 180].replace("\n", " ")[:420])
        print("---")
        idx = i + len(key)
        n += 1

# Extract module api/all/api.js content markers
m = re.search(r'\./src/api/all/api\.js["\']', data)
print("module marker", bool(m), m.start() if m else None)

# Find strings containing Data with /api
apis = sorted(set(re.findall(r"['\"]([^'\"]*api[^'\"]*Data[^'\"]*)['\"]", data, flags=re.I)))
print("api*Data count", len(apis))
for a in apis[:80]:
    print(a)
