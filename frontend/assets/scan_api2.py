from __future__ import annotations

import re
from pathlib import Path

data = Path(__file__).with_name("_app.js").read_text(encoding="utf-8", errors="ignore")

# broader patterns
patterns = [
    r"['\"](/api/[^'\"]+)['\"]",
    r"url:\s*['\"]([^'\"]+)['\"]",
    r"baseURL[^\n]{0,80}",
    r"graphic[^\n]{0,120}",
    r"TXtData[^\n]{0,200}",
    r"getDataType[^\n]{0,200}",
    r"exportExcel[^\n]{0,200}",
    r"wtapi[^\n]{0,120}",
    r"pointIds?[^\n]{0,160}",
    r"calculatingTime[^\n]{0,160}",
]

for p in patterns:
    print("====", p)
    ms = list(re.finditer(p, data))
    print("count", len(ms))
    for m in ms[:12]:
        s = data[max(0, m.start() - 80) : m.end() + 120].replace("\n", " ")
        print(s[:350])
        print("---")
