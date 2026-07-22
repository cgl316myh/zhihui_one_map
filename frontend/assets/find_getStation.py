from pathlib import Path

data = Path(__file__).with_name("_app.js").read_text(encoding="utf-8", errors="ignore")
for key in [
    "getStationExcel",
    "exportExcel",
    "api/device/data",
    "device/data",
    "snType",
    "TXtData",
]:
    print("====", key)
    idx = 0
    for n in range(6):
        i = data.find(key, idx)
        if i < 0:
            break
        print(data[max(0, i - 200) : i + 350].replace("\n", " ")[:500])
        print("---")
        idx = i + len(key)
