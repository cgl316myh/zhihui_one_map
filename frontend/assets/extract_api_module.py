from __future__ import annotations

from pathlib import Path

data = Path(__file__).with_name("_app.js").read_text(encoding="utf-8", errors="ignore")
start = data.find('./src/api/all/api.js":')
print("start", start)
# Find webpack module body roughly until next /***/ ./src/
end = data.find('/***/ }),\n\n/***/ "./src/', start + 50)
if end < 0:
    end = start + 50000
chunk = data[start:end]
Path(__file__).with_name("_api_all_module.js").write_text(chunk, encoding="utf-8")
print("chunk len", len(chunk))
# print function names
import re
for m in re.finditer(r"function ([A-Za-z0-9_]+)\(", chunk):
    print("fn", m.group(1))
for m in re.finditer(r"exports\[\"([^\"]+)\"\]", chunk):
    print("export", m.group(1))
# show snippet around getProjectData
for key in ["getProjectData", "exportExcel", "url:", "basicPoint"]:
    i = chunk.find(key)
    print("==", key, i)
    if i >= 0:
        print(chunk[i : i + 300].replace("\n", " "))
