from __future__ import annotations

import base64
import json
import pathlib
import re
import urllib.error
import urllib.request

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

OUT = pathlib.Path(__file__).resolve().parent
JS48 = OUT / "48.1763535946512.js"
APP = OUT / "app.1763535946512.js"
BASE = "http://wtapi.jgtop1.com"
ACC = "15925118626"
PWD = "228218494@qq.com"


def extract_public_key() -> str:
    text = JS48.read_text(encoding="utf-8", errors="ignore")
    m = re.search(r"var publicKey = ((?:'[^']*'\s*\+\s*)*'[^']*')", text)
    if not m:
        raise RuntimeError("publicKey not found")
    parts = re.findall(r"'([^']*)'", m.group(1))
    key_body = "".join(parts).replace("\\n", "\n")
    pem = (
        "-----BEGIN PUBLIC KEY-----\n"
        + "\n".join(key_body.replace("\n", "").strip()[i : i + 64] for i in range(0, len(key_body.replace("\n", "").strip()), 64))
        + "\n-----END PUBLIC KEY-----\n"
    )
    # key_body may already include newlines as in JS string
    raw = "".join(parts).replace("\\n", "\n").strip()
    if "BEGIN" not in raw:
        pem = "-----BEGIN PUBLIC KEY-----\n" + raw + ("\n" if not raw.endswith("\n") else "") + "-----END PUBLIC KEY-----\n"
        # normalize wrapping
        body = raw.replace("\n", "")
        pem = (
            "-----BEGIN PUBLIC KEY-----\n"
            + "\n".join(body[i : i + 64] for i in range(0, len(body), 64))
            + "\n-----END PUBLIC KEY-----\n"
        )
    (OUT / "public.pem").write_text(pem, encoding="utf-8")
    return pem


def rsa_encrypt(password: str, pem: str) -> str:
    pub = serialization.load_pem_public_key(pem.encode("utf-8"))
    encrypted = pub.encrypt(password.encode("utf-8"), padding.PKCS1v15())
    return base64.b64encode(encrypted).decode("ascii")


def http(method: str, path: str, data=None, headers=None):
    url = BASE + path
    hdrs = {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json, text/plain, */*",
        "Origin": "http://bdlx.jgtop1.com",
        "Referer": "http://bdlx.jgtop1.com/",
    }
    if headers:
        hdrs.update(headers)
    body = None
    if data is not None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        hdrs["Content-Type"] = "application/json;charset=UTF-8"
    req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def get_captcha():
    st, raw = http("GET", "/auth/code")
    data = json.loads(raw.decode("utf-8"))
    img = data["img"]
    if "," in img:
        img = img.split(",", 1)[1]
    (OUT / "cap_login.png").write_bytes(base64.b64decode(img))
    (OUT / "cap_uuid.txt").write_text(data["uuid"], encoding="utf-8")
    return data["uuid"]


def main():
    import sys

    pem = extract_public_key()
    print("public key saved")

    # show login encrypt usage
    app = APP.read_text(encoding="utf-8", errors="ignore")
    idx = app.find("function login(username, password, code, uuid)")
    print(app[idx : idx + 900])

    # encrypt sample
    enc = rsa_encrypt(PWD, pem)
    print("encrypted sample len", len(enc), enc[:40])

    if len(sys.argv) < 2:
        uuid = get_captcha()
        print("captcha ->", OUT / "cap_login.png", "uuid", uuid)
        print("then: python extract_key_login.py <code>")
        return 0

    code = sys.argv[1]
    uuid = (OUT / "cap_uuid.txt").read_text(encoding="utf-8").strip()
    enc_pwd = rsa_encrypt(PWD, pem)
    payload = {
        "username": ACC,
        "password": enc_pwd,
        "code": code,
        "uuid": uuid,
    }
    st, raw = http("POST", "/auth/login", payload)
    text = raw.decode("utf-8", "ignore")
    print("login", st, text[:500])
    (OUT / "login_resp.json").write_text(text, encoding="utf-8")
    return 0 if st == 200 else 1


if __name__ == "__main__":
    raise SystemExit(main())
