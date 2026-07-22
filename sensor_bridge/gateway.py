# -*- coding: utf-8 -*-
"""
智慧矿山传感器网关
- MQTT 订阅（文档：传感器mqtt数据接入说明）
- HTTP POST 推送接收（文档：HTTP或者TCP数据推送接口）
- 向前端提供 /api/* 只读接口（建议 30 秒轮询，勿缩短）

MQTT keepalive 固定 60 秒；断线重连间隔 30 秒，避免心跳/重连过密。
"""
from __future__ import annotations

import json
import os
import socket
import struct
import threading
import time
import traceback
from datetime import datetime, timezone, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config.json"
STORE_DIR = ROOT / "store"
STORE_DIR.mkdir(parents=True, exist_ok=True)
LATEST_PATH = STORE_DIR / "latest.json"
ENV_FALLBACK = ROOT / "../frontend/data/environment.json"
SLOPE_FALLBACK = ROOT / "../frontend/data/slope.json"

TZ8 = timezone(timedelta(hours=8))

# ---------- store ----------
_lock = threading.RLock()
_state: dict[str, Any] = {
    "updatedAt": None,
    "mqtt": {"connected": False, "lastMessageAt": None, "topic": None, "error": None},
    "httpPush": {"lastReceiveAt": None, "count": 0},
    "rawByKey": {},  # key -> last raw payload + meta
    "gnss": {},  # deviceSn -> reading
    "rainfall": {},  # deviceSn -> reading
    "meteo": {},  # clientId/deviceSn -> weather station reading
    "other": {},
}


def _now_iso() -> str:
    return datetime.now(TZ8).isoformat(timespec="seconds")


def load_config() -> dict:
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_config(cfg: dict) -> None:
    """Persist gateway config.json (admin / demo sync)."""
    text = json.dumps(cfg, ensure_ascii=False, indent=2)
    CONFIG_PATH.write_text(text + "\n", encoding="utf-8")


def merge_gateway_config(current: dict, patch: dict) -> dict:
    """Deep-merge admin patch into gateway config; enforce safe minima."""
    out = json.loads(json.dumps(current))  # deep copy via json
    if not isinstance(patch, dict):
        return out
    for key in ("http", "tcp", "mqtt", "frontend"):
        if isinstance(patch.get(key), dict):
            out[key] = {**(out.get(key) or {}), **patch[key]}
    if "pollHintSec" in patch:
        out["pollHintSec"] = patch["pollHintSec"]
    # keep existing environmentStations / slopeDevices / thresholds unless provided
    for key in ("environmentStations", "slopeDevices", "thresholds"):
        if key in patch:
            out[key] = patch[key]

    mqtt = out.get("mqtt") or {}
    try:
        mqtt["keepalive"] = max(30, int(mqtt.get("keepalive") or 60))
    except (TypeError, ValueError):
        mqtt["keepalive"] = 60
    try:
        mqtt["reconnectDelaySec"] = max(30, int(mqtt.get("reconnectDelaySec") or 30))
    except (TypeError, ValueError):
        mqtt["reconnectDelaySec"] = 30
    try:
        mqtt["port"] = int(mqtt.get("port") or 1883)
    except (TypeError, ValueError):
        mqtt["port"] = 1883
    out["mqtt"] = mqtt

    http = out.get("http") or {}
    try:
        http["port"] = int(http.get("port") or 5173)
    except (TypeError, ValueError):
        http["port"] = 5173
    http["pushPath"] = http.get("pushPath") or "/api/push"
    out["http"] = http

    tcp = out.get("tcp") or {}
    try:
        tcp["port"] = int(tcp.get("port") or 9000)
    except (TypeError, ValueError):
        tcp["port"] = 9000
    out["tcp"] = tcp

    try:
        out["pollHintSec"] = max(30, int(out.get("pollHintSec") or 30))
    except (TypeError, ValueError):
        out["pollHintSec"] = 30

    fe = out.get("frontend") or {}
    try:
        fe["pollIntervalMs"] = max(30000, int(fe.get("pollIntervalMs") or 30000))
    except (TypeError, ValueError):
        fe["pollIntervalMs"] = 30000
    out["frontend"] = fe
    return out


def save_latest() -> None:
    with _lock:
        payload = dict(_state)
        # don't dump huge history
        text = json.dumps(payload, ensure_ascii=False, indent=2)
    LATEST_PATH.write_text(text, encoding="utf-8")


def _pick(d: dict, *keys, default=None):
    for k in keys:
        if k in d and d[k] is not None and d[k] != "":
            return d[k]
    return default


def _to_float(v, default=None):
    try:
        if v is None or v == "":
            return default
        return float(v)
    except (TypeError, ValueError):
        return default


def _is_night(dt: datetime | None = None) -> bool:
    dt = dt or datetime.now(TZ8)
    return dt.hour >= 22 or dt.hour < 6


# ---------- ingest ----------
def ingest_payload(payload: dict, source: str, topic: str | None = None) -> None:
    """Normalize MQTT / HTTP push JSON into store."""
    if not isinstance(payload, dict):
        return

    # HTTP meteo push style
    if any(
        k in payload
        for k in (
            "ambientTemperature",
            "ambientHumidity",
            "ambientTemp",
            "clientId",
            "PM2.5",
            "PM10",
            "noise",
            "noise1",
        )
    ) and "deviceType" not in payload:
        _ingest_meteo(payload, source)
        return

    device_type = str(payload.get("deviceType", "")).strip()
    device_sn = str(payload.get("deviceSn") or payload.get("sn") or "").strip()

    if device_type == "2" or ("x" in payload and "y" in payload and device_sn):
        _ingest_gnss(payload, source, topic)
        return
    if device_type in ("1",) or ("rainHour" in payload or "rainDay" in payload):
        # rainfall (type 1 or duplicate rain schema)
        if device_type in ("", "1", "5") and ("rainHour" in payload or "rainDay" in payload):
            _ingest_rain(payload, source, topic)
            return
    if device_type in ("3", "4", "5"):
        _ingest_other(payload, source, topic)
        return

    # fallback: treat as meteo if looks like env
    if device_sn or payload.get("clientId"):
        _ingest_meteo(payload, source)


def _ingest_gnss(payload: dict, source: str, topic: str | None) -> None:
    sn = str(payload.get("deviceSn") or "").strip()
    if not sn:
        return
    item = {
        "deviceSn": sn,
        "collectTime": payload.get("collectTime"),
        "x": _to_float(payload.get("x"), 0),
        "y": _to_float(payload.get("y"), 0),
        "h": _to_float(payload.get("z", payload.get("h")), 0),
        "deviceType": str(payload.get("deviceType", "2")),
        "source": source,
        "topic": topic,
        "receivedAt": _now_iso(),
        "raw": payload,
    }
    with _lock:
        _state["gnss"][sn] = item
        _state["rawByKey"][f"gnss:{sn}"] = item
        _state["updatedAt"] = _now_iso()
        if source == "mqtt":
            _state["mqtt"]["lastMessageAt"] = _now_iso()
    save_latest()


def _ingest_rain(payload: dict, source: str, topic: str | None) -> None:
    sn = str(payload.get("deviceSn") or "").strip() or "rain-unknown"
    item = {
        "deviceSn": sn,
        "collectTime": payload.get("collectTime"),
        "rainHour": _to_float(payload.get("rainHour"), 0),
        "rainDay": _to_float(payload.get("rainDay"), 0),
        "errcode": payload.get("errcode", 0),
        "devChx": payload.get("devChx"),
        "source": source,
        "topic": topic,
        "receivedAt": _now_iso(),
        "raw": payload,
    }
    with _lock:
        _state["rainfall"][sn] = item
        _state["rawByKey"][f"rain:{sn}"] = item
        _state["updatedAt"] = _now_iso()
        if source == "mqtt":
            _state["mqtt"]["lastMessageAt"] = _now_iso()
    save_latest()


def _ingest_other(payload: dict, source: str, topic: str | None) -> None:
    sn = str(payload.get("deviceSn") or "unknown").strip()
    dtype = str(payload.get("deviceType", "other"))
    item = {
        "deviceSn": sn,
        "deviceType": dtype,
        "collectTime": payload.get("collectTime"),
        "source": source,
        "topic": topic,
        "receivedAt": _now_iso(),
        "raw": payload,
    }
    with _lock:
        _state["other"][f"{dtype}:{sn}"] = item
        _state["rawByKey"][f"other:{dtype}:{sn}"] = item
        _state["updatedAt"] = _now_iso()
    save_latest()


def _ingest_meteo(payload: dict, source: str) -> None:
    key = str(
        payload.get("clientId")
        or payload.get("deviceSn")
        or payload.get("deviceId")
        or "meteo-default"
    ).strip()
    temp = _to_float(
        _pick(
            payload,
            "ambientTemperature",
            "ambientTemp",
            "ambientTemperature1",
            "Airtemperature",
            "amt",
            "Temp",
        )
    )
    hum = _to_float(
        _pick(
            payload,
            "ambientHumidity",
            "ambientHum",
            "ambientHumidity1",
            "Airhumidity",
            "amh",
            "tambientHumidity",
        )
    )
    noise = _to_float(_pick(payload, "noise", "noise1", "noi"))
    pm25 = _to_float(_pick(payload, "PM2.5", "p25", "pm25"))
    pm10 = _to_float(_pick(payload, "PM10", "p10", "pm10"))
    dust = _to_float(_pick(payload, "TSP", "dust"))
    pressure = _to_float(_pick(payload, "pressure", "pre"))
    wind = _to_float(_pick(payload, "windSpeed", "wsp"))
    rain = _to_float(_pick(payload, "rainfall", "raininess"))
    lng = _to_float(_pick(payload, "longitude"))
    lat = _to_float(_pick(payload, "latitude"))
    detected = payload.get("detectedTime") or payload.get("collectTime")

    item = {
        "id": key,
        "clientId": payload.get("clientId"),
        "deviceSn": payload.get("deviceSn"),
        "detectedTime": detected,
        "temperature": temp,
        "humidity": hum,
        "noise": noise,
        "pm25": pm25,
        "pm10": pm10,
        "dust": dust,
        "pressure": pressure,
        "windSpeed": wind,
        "rainfall": rain,
        "lng": lng,
        "lat": lat,
        "source": source,
        "receivedAt": _now_iso(),
        "raw": payload,
    }
    with _lock:
        _state["meteo"][key] = item
        _state["rawByKey"][f"meteo:{key}"] = item
        _state["updatedAt"] = _now_iso()
        _state["httpPush"]["lastReceiveAt"] = _now_iso()
        _state["httpPush"]["count"] = int(_state["httpPush"].get("count") or 0) + (
            1 if source == "http" else 0
        )
        if source == "mqtt":
            _state["mqtt"]["lastMessageAt"] = _now_iso()
    save_latest()


# ---------- build API views ----------
def _env_status(metrics: dict, cfg: dict) -> str:
    th = cfg.get("thresholds") or {}
    noise = metrics.get("noise")
    if noise is not None:
        limit = th.get("noiseNight") if _is_night() else th.get("noiseDay")
        if limit is not None and noise > float(limit):
            return "alarm"
    pm25 = metrics.get("pm25")
    if pm25 is not None and th.get("pm25") is not None and pm25 > float(th["pm25"]):
        return "warn"
    pm10 = metrics.get("pm10")
    if pm10 is not None and th.get("pm10") is not None and pm10 > float(th["pm10"]):
        return "warn"
    return "normal"


def build_environment(cfg: dict) -> dict:
    stations = cfg.get("environmentStations") or []
    with _lock:
        meteo = dict(_state["meteo"])

    # Prefer mapped clientIds/deviceSns; otherwise fill by arrival order
    unused = list(meteo.values())
    unused.sort(key=lambda x: x.get("receivedAt") or "", reverse=True)

    points = []
    used_keys = set()
    for st in stations:
        matched = None
        for cid in st.get("clientIds") or []:
            if cid in meteo:
                matched = meteo[cid]
                break
        if not matched:
            for sn in st.get("deviceSns") or []:
                if sn in meteo:
                    matched = meteo[sn]
                    break
                for v in meteo.values():
                    if str(v.get("deviceSn") or "") == str(sn):
                        matched = v
                        break
                if matched:
                    break
        if not matched:
            for v in unused:
                k = v.get("id")
                if k not in used_keys:
                    matched = v
                    break
        if matched:
            used_keys.add(matched.get("id"))
            metrics = {}
            units = {}
            if matched.get("temperature") is not None:
                metrics["temperature"] = matched["temperature"]
                units["temperature"] = "℃"
            if matched.get("humidity") is not None:
                metrics["humidity"] = matched["humidity"]
                units["humidity"] = "%"
            if matched.get("noise") is not None:
                metrics["noise"] = matched["noise"]
                units["noise"] = "dB"
            if matched.get("pm25") is not None:
                metrics["pm25"] = matched["pm25"]
                units["pm25"] = "μg/m³"
            if matched.get("pm10") is not None:
                metrics["pm10"] = matched["pm10"]
                units["pm10"] = "μg/m³"
            if matched.get("dust") is not None:
                metrics["dust"] = matched["dust"]
                units["dust"] = "μg/m³"
            lng = matched.get("lng") if matched.get("lng") is not None else st.get("lng")
            lat = matched.get("lat") if matched.get("lat") is not None else st.get("lat")
            points.append(
                {
                    "id": st["id"],
                    "name": st.get("name") or st["id"],
                    "location": st.get("location") or "",
                    "lng": lng,
                    "lat": lat,
                    "status": _env_status(metrics, cfg),
                    "metrics": metrics,
                    "units": units,
                    "source": matched.get("source"),
                    "detectedTime": matched.get("detectedTime"),
                    "sensorKey": matched.get("id"),
                }
            )
        else:
            # keep station shell so UI still shows 3 slots
            points.append(
                {
                    "id": st["id"],
                    "name": st.get("name") or st["id"],
                    "location": st.get("location") or "",
                    "lng": st.get("lng"),
                    "lat": st.get("lat"),
                    "status": "offline",
                    "metrics": {},
                    "units": {},
                    "source": None,
                    "detectedTime": None,
                    "sensorKey": None,
                }
            )

    # If no station mapping produced metrics but we have meteo, synthesize points
    if meteo and not any(p.get("metrics") for p in points):
        points = []
        for i, (key, m) in enumerate(list(meteo.items())[:3]):
            metrics = {}
            units = {}
            for mk, uk, label in (
                ("temperature", "℃", "temperature"),
                ("humidity", "%", "humidity"),
                ("noise", "dB", "noise"),
                ("pm25", "μg/m³", "pm25"),
                ("pm10", "μg/m³", "pm10"),
            ):
                if m.get(mk) is not None:
                    metrics[label] = m[mk]
                    units[label] = uk
            points.append(
                {
                    "id": f"ENV-{i+1:02d}",
                    "name": f"环境监测 · {key[:8]}",
                    "location": "传感器推送",
                    "lng": m.get("lng") or 102.446,
                    "lat": m.get("lat") or 24.787,
                    "status": _env_status(metrics, cfg),
                    "metrics": metrics,
                    "units": units,
                    "source": m.get("source"),
                    "detectedTime": m.get("detectedTime"),
                    "sensorKey": key,
                }
            )

    live = any(p.get("metrics") for p in points)
    if not live:
        # fallback to local mock so prototype still works offline
        try:
            fb = json.loads(Path(ENV_FALLBACK).resolve().read_text(encoding="utf-8"))
            fb["live"] = False
            fb["source"] = "fallback-mock"
            return fb
        except Exception:
            pass

    return {
        "updatedAt": _now_iso(),
        "live": True,
        "source": "sensor-bridge",
        "points": points,
    }


def build_slope(cfg: dict) -> dict:
    mapping = cfg.get("slopeDevices") or {}
    with _lock:
        gnss = dict(_state["gnss"])
        rains = dict(_state["rainfall"])

    points = []
    for sn, meta in mapping.items():
        if meta.get("type") != "displacement":
            continue
        g = gnss.get(sn)
        if not g:
            continue
        points.append(
            {
                "id": meta.get("id") or sn,
                "name": meta.get("name") or sn,
                "sn": sn,
                "x": g.get("x"),
                "y": g.get("y"),
                "h": g.get("h"),
                "unit": "mm",
                "status": "normal",
                "updatedAt": g.get("collectTime") or g.get("receivedAt"),
                "series": [],
            }
        )

    # also include unmapped gnss
    for sn, g in gnss.items():
        if sn in mapping:
            continue
        points.append(
            {
                "id": sn,
                "name": sn,
                "sn": sn,
                "x": g.get("x"),
                "y": g.get("y"),
                "h": g.get("h"),
                "unit": "mm",
                "status": "normal",
                "updatedAt": g.get("collectTime") or g.get("receivedAt"),
                "series": [],
            }
        )

    rainfall = None
    # prefer mapped rain sn
    rain_meta = None
    rain_sn = None
    for sn, meta in mapping.items():
        if meta.get("type") == "rainfall":
            rain_meta = meta
            rain_sn = sn
            break
    rain_item = rains.get(rain_sn) if rain_sn else None
    if not rain_item and rains:
        rain_sn, rain_item = next(iter(rains.items()))
    if rain_item:
        rainfall = {
            "id": (rain_meta or {}).get("id") or rain_sn,
            "name": (rain_meta or {}).get("name") or "雨量",
            "valueMm": rain_item.get("rainHour"),
            "cumulativeMm": rain_item.get("rainDay"),
            "yl24h": None,
            "status": "alarm" if rain_item.get("errcode") not in (0, "0", None) else "normal",
            "unit": "mm",
            "updatedAt": rain_item.get("collectTime") or rain_item.get("receivedAt"),
            "series": [],
        }

    live = bool(points or rainfall)
    if not live:
        try:
            fb = json.loads(Path(SLOPE_FALLBACK).resolve().read_text(encoding="utf-8"))
            fb["live"] = False
            fb["sourceNote"] = "fallback-local-json"
            return fb
        except Exception:
            return {
                "updatedAt": _now_iso(),
                "live": False,
                "rainfall": None,
                "points": [],
            }

    return {
        "updatedAt": _now_iso(),
        "live": True,
        "source": "sensor-bridge-mqtt",
        "sourceUrl": "",
        "projectName": "MQTT/HTTP 传感器接入",
        "rainfall": rainfall,
        "points": points,
    }


def build_status(cfg: dict) -> dict:
    with _lock:
        st = {
            "updatedAt": _state.get("updatedAt"),
            "mqtt": dict(_state["mqtt"]),
            "httpPush": dict(_state["httpPush"]),
            "counts": {
                "gnss": len(_state["gnss"]),
                "rainfall": len(_state["rainfall"]),
                "meteo": len(_state["meteo"]),
                "other": len(_state["other"]),
            },
            "pollHintSec": cfg.get("pollHintSec", 30),
            "mqttKeepaliveSec": (cfg.get("mqtt") or {}).get("keepalive", 60),
            "reconnectDelaySec": (cfg.get("mqtt") or {}).get("reconnectDelaySec", 30),
        }
    return st


# ---------- Minimal MQTT 3.1.1 subscriber (stdlib) ----------
class MqttSubscriber(threading.Thread):
    def __init__(self, cfg: dict):
        super().__init__(daemon=True, name="mqtt-subscriber")
        self.cfg = cfg.get("mqtt") or {}
        self._stop = threading.Event()
        self.sock: socket.socket | None = None

    def stop(self) -> None:
        self._stop.set()
        try:
            if self.sock:
                self.sock.close()
        except Exception:
            pass

    def run(self) -> None:
        if not self.cfg.get("enabled", True):
            with _lock:
                _state["mqtt"]["error"] = "disabled"
            return
        host = self.cfg.get("host")
        port = int(self.cfg.get("port", 1883))
        keepalive = int(self.cfg.get("keepalive", 60))
        # 强制不低于 30 秒，避免心跳过密
        if keepalive < 30:
            keepalive = 60
        reconnect = int(self.cfg.get("reconnectDelaySec", 30))
        if reconnect < 15:
            reconnect = 30
        topic = self.cfg.get("topic") or "#"
        username = self.cfg.get("username") or ""
        password = self.cfg.get("password") or ""
        client_id = self.cfg.get("clientId") or f"mine-bridge-{os.getpid()}"

        with _lock:
            _state["mqtt"]["topic"] = topic
            _state["mqtt"]["keepalive"] = keepalive

        while not self._stop.is_set():
            try:
                self._session(host, port, client_id, username, password, topic, keepalive)
            except Exception as e:
                with _lock:
                    _state["mqtt"]["connected"] = False
                    _state["mqtt"]["error"] = str(e)
                print(f"[mqtt] disconnected: {e}; reconnect in {reconnect}s", flush=True)
                self._stop.wait(reconnect)

    def _session(
        self,
        host: str,
        port: int,
        client_id: str,
        username: str,
        password: str,
        topic: str,
        keepalive: int,
    ) -> None:
        print(f"[mqtt] connecting {host}:{port} keepalive={keepalive}s topic={topic}", flush=True)
        sock = socket.create_connection((host, port), timeout=20)
        sock.settimeout(1.0)
        self.sock = sock

        # CONNECT
        sock.sendall(self._encode_connect(client_id, username, password, keepalive))
        packet = self._read_packet(sock)
        if not packet or packet[0] >> 4 != 2:
            raise RuntimeError("MQTT CONNACK missing")
        if len(packet) < 4 or packet[3] != 0:
            code = packet[3] if len(packet) > 3 else -1
            raise RuntimeError(f"MQTT CONNACK refused code={code}")

        # SUBSCRIBE
        sock.sendall(self._encode_subscribe(1, topic))
        # wait SUBACK (optional)
        with _lock:
            _state["mqtt"]["connected"] = True
            _state["mqtt"]["error"] = None
        print("[mqtt] connected & subscribed", flush=True)

        last_ping = time.time()
        while not self._stop.is_set():
            # PINGREQ every keepalive (not shorter)
            if time.time() - last_ping >= keepalive * 0.9:
                sock.sendall(bytes([0xC0, 0x00]))
                last_ping = time.time()
            try:
                pkt = self._read_packet(sock)
            except socket.timeout:
                continue
            if not pkt:
                raise RuntimeError("MQTT socket closed")
            ptype = pkt[0] >> 4
            if ptype == 3:  # PUBLISH
                self._handle_publish(pkt, topic)
            elif ptype == 13:  # PINGRESP
                pass
            elif ptype == 9:  # SUBACK
                pass

    def _handle_publish(self, pkt: bytes, default_topic: str) -> None:
        # pkt = fixed_header_byte + variable_header_and_payload（remaining length 已剥除）
        if len(pkt) < 4:
            return
        i = 1
        tlen = struct.unpack("!H", pkt[i : i + 2])[0]
        i += 2
        if i + tlen > len(pkt):
            return
        topic = pkt[i : i + tlen].decode("utf-8", errors="replace")
        i += tlen
        qos = (pkt[0] & 0x06) >> 1
        if qos:
            if i + 2 > len(pkt):
                return
            i += 2  # packet id
        payload_bytes = pkt[i:]
        try:
            text = payload_bytes.decode("utf-8", errors="replace").strip()
            data = json.loads(text)
        except Exception:
            print(f"[mqtt] non-json on {topic}: {payload_bytes[:120]!r}", flush=True)
            return
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict):
                    ingest_payload(item, "mqtt", topic)
        elif isinstance(data, dict):
            ingest_payload(data, "mqtt", topic)
        print(f"[mqtt] message topic={topic}", flush=True)

    @staticmethod
    def _encode_str(s: str) -> bytes:
        b = s.encode("utf-8")
        return struct.pack("!H", len(b)) + b

    def _encode_connect(self, client_id: str, username: str, password: str, keepalive: int) -> bytes:
        # protocol MQTT 3.1.1
        vh = self._encode_str("MQTT") + bytes([0x04])
        flags = 0x02  # clean session
        if username:
            flags |= 0x80
        if password:
            flags |= 0x40
        vh += bytes([flags]) + struct.pack("!H", keepalive)
        payload = self._encode_str(client_id)
        if username:
            payload += self._encode_str(username)
        if password:
            payload += self._encode_str(password)
        body = vh + payload
        return bytes([0x10]) + self._encode_remaining_length(len(body)) + body

    def _encode_subscribe(self, packet_id: int, topic: str) -> bytes:
        body = struct.pack("!H", packet_id) + self._encode_str(topic) + bytes([0x00])
        return bytes([0x82]) + self._encode_remaining_length(len(body)) + body

    @staticmethod
    def _encode_remaining_length(length: int) -> bytes:
        out = bytearray()
        x = length
        while True:
            digit = x % 128
            x //= 128
            if x > 0:
                digit |= 0x80
            out.append(digit)
            if x == 0:
                break
        return bytes(out)

    def _read_packet(self, sock: socket.socket) -> bytes | None:
        header = self._recv_exact(sock, 1)
        if not header:
            return None
        multiplier = 1
        value = 0
        while True:
            encoded = self._recv_exact(sock, 1)
            if not encoded:
                return None
            digit = encoded[0]
            value += (digit & 127) * multiplier
            if (digit & 128) == 0:
                break
            multiplier *= 128
            if multiplier > 128 * 128 * 128:
                raise RuntimeError("remaining length overflow")
        body = self._recv_exact(sock, value) if value else b""
        if body is None:
            return None
        return header + body

    @staticmethod
    def _recv_exact(sock: socket.socket, n: int) -> bytes | None:
        buf = bytearray()
        while len(buf) < n:
            try:
                chunk = sock.recv(n - len(buf))
            except socket.timeout:
                if not buf:
                    raise
                continue
            if not chunk:
                return None if not buf else bytes(buf)
            buf.extend(chunk)
        return bytes(buf)


# ---------- HTTP server ----------
class GatewayHandler(SimpleHTTPRequestHandler):
    cfg: dict = {}
    static_root: Path = ROOT / "../frontend"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(self.static_root.resolve()), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        # quieter for static assets
        path = args[0] if args else ""
        if isinstance(path, str) and path.startswith('"GET /api'):
            print("[http]", fmt % args, flush=True)
        elif isinstance(path, str) and ("POST" in path or "/api/" in path):
            print("[http]", fmt % args, flush=True)

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Cache-Control", "no-store")

    def _json(self, code: int, obj: Any) -> None:
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self._cors()
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_PUT(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        if path == "/api/config":
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else b"{}"
            try:
                patch = json.loads(body.decode("utf-8") if body else "{}")
            except Exception:
                self._json(400, {"ok": False, "error": "invalid json"})
                return
            if not isinstance(patch, dict):
                self._json(400, {"ok": False, "error": "json object required"})
                return
            try:
                current = load_config()
                merged = merge_gateway_config(current, patch)
                save_config(merged)
                # hot-update in-memory cfg (MQTT thread still uses start-time params until restart)
                self.cfg = merged
                GatewayHandler.cfg = merged
            except Exception as e:
                self._json(500, {"ok": False, "error": str(e)})
                return
            self._json(
                200,
                {
                    "ok": True,
                    "message": "config.json 已更新；MQTT 连接参数建议重启 gateway.py 后生效",
                    "config": merged,
                },
            )
            return
        self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        push_path = (self.cfg.get("http") or {}).get("pushPath", "/api/push").rstrip("/")
        if path in (push_path, "/api/push", "/"):
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else b""
            try:
                data = json.loads(body.decode("utf-8") if body else "{}")
            except Exception:
                self._json(400, {"ok": False, "error": "invalid json"})
                return
            if isinstance(data, list):
                for item in data:
                    if isinstance(item, dict):
                        ingest_payload(item, "http")
            elif isinstance(data, dict):
                ingest_payload(data, "http")
            else:
                self._json(400, {"ok": False, "error": "json object/array required"})
                return
            print(f"[http-push] received {length} bytes", flush=True)
            self._json(200, {"ok": True, "receivedAt": _now_iso()})
            return
        self._json(404, {"ok": False, "error": "not found"})

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/status":
            self._json(200, build_status(self.cfg))
            return
        if path == "/api/config":
            # 返回当前文件配置（含密钥，仅演示后台使用）
            try:
                self._json(200, {"ok": True, "config": load_config()})
            except Exception as e:
                self._json(500, {"ok": False, "error": str(e)})
            return
        if path == "/api/environment":
            self._json(200, build_environment(self.cfg))
            return
        if path == "/api/slope":
            self._json(200, build_slope(self.cfg))
            return
        if path == "/api/sensors":
            with _lock:
                snap = {
                    "updatedAt": _state.get("updatedAt"),
                    "mqtt": dict(_state["mqtt"]),
                    "httpPush": dict(_state["httpPush"]),
                    "gnss": dict(_state["gnss"]),
                    "rainfall": dict(_state["rainfall"]),
                    "meteo": {k: {kk: vv for kk, vv in v.items() if kk != "raw"} for k, v in _state["meteo"].items()},
                    "other": dict(_state["other"]),
                    "pollHintSec": self.cfg.get("pollHintSec", 30),
                }
            self._json(200, snap)
            return
        if path == "/api/sensors/latest":
            # compact for UI
            self._json(
                200,
                {
                    "environment": build_environment(self.cfg),
                    "slope": build_slope(self.cfg),
                    "status": build_status(self.cfg),
                },
            )
            return

        # static
        if path == "/":
            self.path = "/index.html"
        return SimpleHTTPRequestHandler.do_GET(self)


def seed_demo_if_empty(cfg: dict) -> None:
    """Optional: no auto seed; keep empty until real push/mqtt."""
    return


def main() -> None:
    cfg = load_config()
    http_cfg = cfg.get("http") or {}
    host = http_cfg.get("host", "0.0.0.0")
    port = int(http_cfg.get("port", 5173))
    static_dir = (ROOT / http_cfg.get("staticDir", "../frontend")).resolve()

    GatewayHandler.cfg = cfg
    GatewayHandler.static_root = static_dir
    GatewayHandler.extensions_map = {
        **getattr(SimpleHTTPRequestHandler, "extensions_map", {}),
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".css": "text/css",
        ".html": "text/html",
    }

    # load previous store
    if LATEST_PATH.exists():
        try:
            prev = json.loads(LATEST_PATH.read_text(encoding="utf-8"))
            with _lock:
                for k in ("gnss", "rainfall", "meteo", "other", "rawByKey", "mqtt", "httpPush"):
                    if k in prev and isinstance(prev[k], dict):
                        _state[k].update(prev[k])
                _state["updatedAt"] = prev.get("updatedAt")
            print(f"[store] loaded {LATEST_PATH}", flush=True)
        except Exception as e:
            print(f"[store] load failed: {e}", flush=True)

    mqtt_thread = MqttSubscriber(cfg)
    mqtt_thread.start()

    server = ThreadingHTTPServer((host, port), GatewayHandler)
    push_path = (http_cfg.get("pushPath") or "/api/push")
    print("=" * 60, flush=True)
    print(f"Sensor bridge  http://127.0.0.1:{port}/", flush=True)
    print(f"HTTP 推送接收  POST http://<公网IP>:{port}{push_path}", flush=True)
    print(f"前端轮询建议   每 {cfg.get('pollHintSec', 30)} 秒 GET /api/sensors/latest", flush=True)
    print(
        f"MQTT           {cfg['mqtt'].get('host')}:{cfg['mqtt'].get('port')} "
        f"keepalive={cfg['mqtt'].get('keepalive', 60)}s reconnect={cfg['mqtt'].get('reconnectDelaySec', 30)}s",
        flush=True,
    )
    print("=" * 60, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down...", flush=True)
    finally:
        mqtt_thread.stop()
        server.server_close()


if __name__ == "__main__":
    main()
