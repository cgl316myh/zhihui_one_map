import re
import urllib.request

url = "http://userweb.jgtop1.com/js/app.1763535946512.js"
data = urllib.request.urlopen(url, timeout=60).read().decode("utf-8", "ignore")

for kw in [
    "captcha",
    "Captcha",
    "verifyCode",
    "verCode",
    "login",
    "adminapi",
    "yierdata",
    "basicPoint",
    "pointlist",
]:
    idxs = [m.start() for m in re.finditer(kw, data)]
    print(f"=== {kw} count={len(idxs)} ===")
    for i in idxs[:8]:
        print(data[max(0, i - 80) : i + 120].replace("\n", " ")[:220])
        print("---")
