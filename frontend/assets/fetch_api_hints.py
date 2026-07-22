import re
import urllib.request

url = "http://userweb.jgtop1.com/js/app.1763535946512.js"
data = urllib.request.urlopen(url, timeout=60).read().decode("utf-8", "ignore")
print("len", len(data))
paths = sorted(set(re.findall(r"[\"'](/[a-zA-Z0-9_./-]{3,100})[\"']", data)))
keys = ("login", "captcha", "code", "user", "auth", "monitor", "warn", "device", "project", "point")
interesting = [p for p in paths if any(k in p.lower() for k in keys)]
print("\n".join(interesting[:80]))
hosts = sorted(set(re.findall(r"https?://[a-zA-Z0-9._:-]+", data)))
print("---hosts---")
print("\n".join(hosts[:40]))
