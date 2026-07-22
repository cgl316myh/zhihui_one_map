import json
import urllib.parse
import urllib.request

host = "bdlx.jgtop1.com"
base = "http://adminapi.yierdata.com/api/mAdmin"

for name in ["login", "Login", "userLogin", "getCode", "captcha", "code", "verify"]:
    url = f"{base}?name={urllib.parse.quote(name)}&host={host}"
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            body = r.read().decode("utf-8", "ignore")
        print(name, "->", body[:300])
    except Exception as e:
        print(name, "ERR", e)
