# -*- coding: utf-8 -*-
"""向本地网关模拟 HTTP 推送（文档：HTTP或者TCP数据推送接口）"""
from __future__ import annotations

import json
import random
import urllib.request
from datetime import datetime

URL = "http://127.0.0.1:5173/api/push"


def main() -> None:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    payload = {
        "ambientTemperature": round(20 + random.random() * 10, 2),
        "ambientHumidity": round(40 + random.random() * 30, 2),
        "pressure": round(95 + random.random() * 5, 2),
        "windSpeed": round(random.random() * 3, 1),
        "windScale": 1,
        "windDirection": 225,
        "rainfall": 0,
        "noise": round(45 + random.random() * 25, 1),
        "PM2.5": round(15 + random.random() * 60, 1),
        "PM10": round(30 + random.random() * 90, 1),
        "RSSI": 31,
        "clientId": "Pczd8HKi3MdgGTW6SAeB",
        "detectedTime": now,
        "longitude": 102.4459,
        "latitude": 24.7865,
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        URL,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        print(resp.status, resp.read().decode("utf-8"))


if __name__ == "__main__":
    main()
