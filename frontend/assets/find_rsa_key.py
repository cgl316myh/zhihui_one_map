import re
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent
urls = [
    "http://userweb.jgtop1.com/js/app.1763535946512.js",
    "http://userweb.jgtop1.com/js/10.1763535946512.js",
    "http://userweb.jgtop1.com/js/24.1763535946512.js",
    "http://userweb.jgtop1.com/js/48.1763535946512.js",
]

pat = re.compile(
    r"(publicKey|PUBLIC_KEY|encryptLong|JSEncrypt|setPublicKey|-----BEGIN PUBLIC KEY-----|"
    r"MIGfMA0GCS|login.*password|encrypt\()",
    re.I,
)

for url in urls:
    print("fetch", url)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    data = urllib.request.urlopen(req, timeout=60).read()
    name = url.rsplit("/", 1)[-1]
    path = OUT / name
    path.write_bytes(data)
    text = data.decode("utf-8", "ignore")
    print("  size", len(data))
    for m in pat.finditer(text):
        start = max(0, m.start() - 80)
        end = min(len(text), m.end() + 120)
        snippet = text[start:end].replace("\n", " ")
        print("  HIT", snippet[:240])
        print("  ---")
