"""
Clientes de API por fabricante, somente leitura:

- Antminer  -> Vnish, via API HTTP  http://IP/api/v1/summary
               (traz power_consumption medido; alguns modelos devolvem 0 e caem
                pra estimativa por eficiencia W/TH).
- Whatsminer-> BixBit, via socket 4028 "summary" (dados vem embrulhados em "Msg").
- Avalon    -> firmware oficial, via socket 4028 "estats" (string MM ID + PS[]).
"""

import asyncio
import base64
import hashlib
import json
import re
import struct
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

import httpx
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from passlib.hash import md5_crypt

SOCKET_TIMEOUT = 6
HTTP_TIMEOUT = 6

# Fallback: eficiencia W/TH por familia de modelo. So e usado quando a maquina
# NAO reporta consumo real (ex.: S19 XP em imersao).
EFFICIENCY_WTH = {
    "S21 PRO": 15.0, "S21": 17.5, "T21": 19.0,
    "S19 XP": 21.5, "S19J PRO": 30.5, "S19J": 33.0,
    "S19 PRO": 29.5, "S19": 34.5, "T19": 38.0,
    "M60": 20.0, "M50": 26.0, "M30": 38.0, "M31": 42.0, "M32": 45.0,
    "1566": 18.5, "1466": 21.0, "1366": 25.0, "1246": 38.0,  # Avalon (familia)
    "L7": 0.0,  # Scrypt: unidade diferente, nao estimar
}
GENERIC_WTH = 30.0

# Tensao de LINHA (V) usada para derivar a corrente de entrada quando o
# consumo e conhecido mas a corrente nao e reportada pelo firmware.
GRID_VOLTAGE = 230.0


def _f(v, default=None):
    try:
        if v is None:
            return default
        if isinstance(v, (int, float)):
            return float(v)
        return float(str(v).strip())
    except (ValueError, TypeError):
        return default


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _first(d, *keys, default=None):
    for k in keys:
        if k in d and d[k] not in (None, ""):
            return d[k]
    return default


# =================== TRANSPORTE ===================

async def api_call(ip, port, command, timeout=SOCKET_TIMEOUT):
    """API socket cgminer/bmminer/btminer (porta 4028)."""
    reader, writer = await asyncio.wait_for(
        asyncio.open_connection(ip, port), timeout=timeout
    )
    try:
        writer.write(json.dumps({"command": command}).encode())
        await writer.drain()
        chunks = []
        while True:
            chunk = await asyncio.wait_for(reader.read(8192), timeout=timeout)
            if not chunk:
                break
            chunks.append(chunk)
        raw = b"".join(chunks)
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
    text = raw.decode("utf-8", errors="ignore").replace("\x00", "").strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        text = re.sub(r",\s*}", "}", text)
        text = re.sub(r",\s*]", "]", text)
        return json.loads(text)


def _http_get_json_sync(url, timeout):
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", errors="ignore"))


async def http_get_json(url, timeout=HTTP_TIMEOUT):
    return await asyncio.to_thread(_http_get_json_sync, url, timeout)


async def _raw_socket_json(ip, port, payload, framed=False, timeout=SOCKET_TIMEOUT):
    """Envia JSON bruto; API v3 usa tamanho little-endian antes do corpo."""
    reader, writer = await asyncio.wait_for(asyncio.open_connection(ip, port), timeout=timeout)
    raw_payload = json.dumps(payload, separators=(",", ":")).encode()
    try:
        writer.write((struct.pack("<I", len(raw_payload)) if framed else b"") + raw_payload)
        await writer.drain()
        if framed:
            size = struct.unpack("<I", await asyncio.wait_for(reader.readexactly(4), timeout=timeout))[0]
            raw = await asyncio.wait_for(reader.readexactly(size), timeout=timeout)
        else:
            chunks = []
            while True:
                chunk = await asyncio.wait_for(reader.read(8192), timeout=timeout)
                if not chunk:
                    break
                chunks.append(chunk)
            raw = b"".join(chunks)
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
    return json.loads(raw.decode("utf-8", errors="ignore").replace("\x00", "").strip())


# =================== HELPERS DE PARSING ===================

def _get_list(resp, key):
    """Pega uma lista (SUMMARY/POOLS/STATS) lidando com o embrulho 'Msg' do BixBit."""
    if isinstance(resp.get(key), list):
        return resp[key]
    msg = resp.get("Msg")
    if isinstance(msg, dict) and isinstance(msg.get(key), list):
        return msg[key]
    if isinstance(msg, list) and key == "STATS":
        return msg
    return []


def _summary0(resp):
    lst = _get_list(resp, "SUMMARY")
    return lst[0] if lst else {}


def _hashrate_ths(d, suffix):
    """Extrai TH/s de qualquer unidade: 'THS/GHS/MHS/KHS <suffix>'."""
    for unit, div in (("THS", 1.0), ("GHS", 1e3), ("MHS", 1e6), ("KHS", 1e9)):
        k = f"{unit} {suffix}"
        if k in d:
            val = _f(d[k])
            if val is not None:
                return round(val / div, 3)
    return None


def _normalize_hashrate(v):
    """Detecta a unidade pela magnitude. Retorna sempre TH/s."""
    v = _f(v)
    if v is None or v <= 0:
        return None
    if v > 1e6:            # MH/s
        return round(v / 1e6, 3)
    if v > 1e3:            # GH/s
        return round(v / 1e3, 3)
    return round(v, 3)     # ja em TH/s


def _pick_hashrate(d, keys):
    for k in keys:
        if k in d:
            n = _normalize_hashrate(d[k])
            if n is not None:
                return n
    return None


def _ws_board_hashrate_sum(devs_resp, keys):
    """Soma o hashrate por hashboard (via 'devs'), em TH/s."""
    devs = _get_list(devs_resp or {}, "DEVS")
    if not devs:
        return None
    total, got = 0.0, False
    for dv in devs:
        for k in keys:
            if k in dv:
                v = _normalize_hashrate(dv[k])
                if v is not None:
                    total += v
                    got = True
                    break
    return round(total, 3) if got else None


def _ws_temp_from_devs(devs_resp):
    temps = []
    for dv in _get_list(devs_resp or {}, "DEVS"):
        for k in ("Chip Temp Max", "Temperature"):
            t = _f(dv.get(k))
            if t and t > 0:
                temps.append(t)
    return max(temps) if temps else None


def _base_record(name, ip, port, mtype):
    return {
        "name": name, "ip": ip, "port": port, "type": mtype,
        "online": True, "error": None, "last_update": _now_iso(),
        "model": None, "hashrate_ths": None, "hashrate_avg_ths": None,
        "power_w": None, "power_estimated": False, "efficiency_jth": None,
        "voltage_v": None, "current_a": None, "volt_source": None,
        "temp_c": None, "env_temp_c": None, "fans_rpm": [],
        "uptime_s": 0, "accepted": 0, "rejected": 0,
        "pool": None, "worker": None,
    }


def _offline_record(name, ip, port, mtype, error):
    rec = _base_record(name, ip, port, mtype)
    rec["online"] = False
    rec["error"] = str(error)
    return rec


def _estimate_power(model, hashrate_ths):
    if not model or not hashrate_ths or hashrate_ths <= 0:
        return (None, False)
    mu = model.upper()
    for key, wth in EFFICIENCY_WTH.items():
        if key in mu:
            if wth <= 0:
                return (None, False)
            return (round(wth * hashrate_ths, 0), True)
    return (round(GENERIC_WTH * hashrate_ths, 0), True)


def _finalize(rec):
    hr = rec.get("hashrate_avg_ths") or rec.get("hashrate_ths")
    if rec.get("type") in ("antminer", "avalon") and rec.get("power_w") and rec["power_w"] > 0:
        rec["voltage_v"] = GRID_VOLTAGE
        rec["current_a"] = round(rec["power_w"] / GRID_VOLTAGE, 1)
        rec["volt_source"] = "230V nominal"
    if not rec.get("efficiency_jth") and rec.get("power_w") and hr and hr > 0:
        rec["efficiency_jth"] = round(rec["power_w"] / hr, 2)
    return rec


def _apply_pool_socket(rec, pools_resp):
    pools = _get_list(pools_resp, "POOLS")
    chosen = None
    for p in pools:
        alive = str(p.get("Status", "")).lower() == "alive"
        active = str(p.get("Stratum Active", "")).lower() in ("true", "1")
        if alive and active:
            chosen = p
            break
    if not chosen and pools:
        chosen = pools[0]
    if chosen:
        rec["pool"] = chosen.get("URL")
        rec["worker"] = chosen.get("User")


# =================== PARSERS ===================

def parse_whatsminer(name, ip, port, summary_resp, pools_resp, devs_resp=None):
    s = _summary0(summary_resp)
    rec = _base_record(name, ip, port, "whatsminer")
    rec["hashrate_avg_ths"] = _pick_hashrate(
        s, ["MHS av", "GHS av", "THS av", "MHS 15m", "HS RT"])
    inst_boards = _ws_board_hashrate_sum(devs_resp, ["MHS 5s", "HS RT", "MHS av"])
    inst_summary = _pick_hashrate(
        s, ["HS RT", "MHS 1m", "MHS 5s", "GHS 5s", "THS 5s", "MHS av", "GHS av"])
    avg = rec["hashrate_avg_ths"]
    if inst_boards is not None and (avg is None or inst_boards >= avg * 0.6):
        rec["hashrate_ths"] = inst_boards
    else:
        rec["hashrate_ths"] = inst_summary
    rec["uptime_s"] = int(_f(_first(s, "Elapsed", "Uptime"), 0))
    rec["accepted"] = int(_f(_first(s, "Accepted"), 0))
    rec["rejected"] = int(_f(_first(s, "Rejected"), 0))
    rec["model"] = _first(s, "Miner Type", "Model")
    temps = [t for t in (_f(_first(s, "Chip Temp Max")),
                         _f(_first(s, "Temperature")),
                         _ws_temp_from_devs(devs_resp)) if t and t > 0]
    rec["temp_c"] = round(max(temps), 1) if temps else None
    rec["env_temp_c"] = _f(_first(s, "Env Temp", "Env Temperature"))
    fan_in = _f(_first(s, "Fan Speed In"))
    fan_out = _f(_first(s, "Fan Speed Out"))
    rec["fans_rpm"] = [x for x in (fan_in, fan_out) if x]
    p = _f(_first(s, "Power", "Power Realtime"))
    if p and p > 0:
        rec["power_w"] = round(p, 1)
        rec["power_estimated"] = False
    vin = _f(_first(s, "PSU Vin0"))
    iin = _f(_first(s, "PSU Iin0"))
    if vin and vin > 0 and iin and iin > 0:
        rec["voltage_v"] = round(vin, 1)
        rec["current_a"] = round(iin, 1)
        rec["volt_source"] = "AC"
    else:
        vout = _f(_first(s, "PSU Vout"))
        iout = _f(_first(s, "PSU Iout"))
        if vout and iout:
            rec["voltage_v"] = round(vout, 2)
            rec["current_a"] = round(iout, 1)
            rec["volt_source"] = "DC"
    pr = _f(_first(s, "Power Rate"))
    if pr and pr > 0:
        rec["efficiency_jth"] = round(pr, 2)

    # M32 (especifico): consumo = tensao x corrente da saida do PSU + 100W
    # fixos da controladora. Sobrepoe o "Power Realtime".
    if "M32" in (rec.get("model") or "").upper():
        vout = _f(_first(s, "PSU Vout"))
        iout = _f(_first(s, "PSU Iout"))
        if vout and iout and vout > 0 and iout > 0:
            rec["power_w"] = round(vout * iout + 100, 1)
            rec["power_estimated"] = False
            rec["voltage_v"] = round(vout, 2)
            rec["current_a"] = round(iout, 1)
            rec["volt_source"] = "DC"
            hr32 = rec.get("hashrate_avg_ths") or rec.get("hashrate_ths")
            if hr32 and hr32 > 0:
                rec["efficiency_jth"] = round(rec["power_w"] / hr32, 2)

    _apply_pool_socket(rec, pools_resp)
    return _finalize(rec)


def parse_antminer_vnish(name, ip, port, summary_json):
    m = summary_json.get("miner", {}) if isinstance(summary_json, dict) else {}
    rec = _base_record(name, ip, port, "antminer")
    rec["model"] = m.get("miner_type")

    inst = _f(m.get("instant_hashrate"))
    if inst is None:
        inst = (_f(m.get("hr_realtime"), 0) or 0) / 1000
    avg = _f(m.get("average_hashrate"))
    if avg is None:
        avg = (_f(m.get("hr_average"), 0) or 0) / 1000
    rec["hashrate_ths"] = round(inst, 3) if inst else None
    rec["hashrate_avg_ths"] = round(avg, 3) if avg else None

    ct = m.get("chip_temp") or {}
    rec["temp_c"] = _f(ct.get("max"))
    chip_maxes = [_f((c.get("chip_temp") or {}).get("max")) for c in m.get("chains", [])]
    chip_maxes = [c for c in chip_maxes if c]
    if chip_maxes:
        rec["temp_c"] = max(chip_maxes)
    fans = [int(_f(f.get("rpm"), 0)) for f in (m.get("cooling", {}).get("fans") or [])
            if _f(f.get("rpm"))]
    rec["fans_rpm"] = fans
    st = m.get("miner_status") or {}
    rec["uptime_s"] = int(_f(st.get("miner_state_time"), 0))

    pc = _f(m.get("power_consumption"), 0)
    if pc and pc > 0:
        rec["power_w"] = round(pc, 1)
        rec["power_estimated"] = False
    else:
        w, est = _estimate_power(rec["model"], rec["hashrate_ths"])
        rec["power_w"] = w
        rec["power_estimated"] = est
    if rec["power_w"] and not rec["power_estimated"]:
        rec["voltage_v"] = GRID_VOLTAGE
        rec["current_a"] = round(rec["power_w"] / GRID_VOLTAGE, 1)
        rec["volt_source"] = "AC_nominal"

    chosen = None
    for p in m.get("pools", []):
        if p.get("pool_type") == "DevFee":
            continue
        if chosen is None or p.get("status") == "active":
            chosen = p
            if p.get("status") == "active":
                break
    if chosen:
        rec["pool"] = chosen.get("url")
        rec["worker"] = chosen.get("user")
        rec["accepted"] = int(_f(chosen.get("accepted"), 0))
        rec["rejected"] = int(_f(chosen.get("rejected"), 0))
    return _finalize(rec)


def parse_avalon(name, ip, port, summary_resp, stats_resp, pools_resp):
    s = _summary0(summary_resp)
    rec = _base_record(name, ip, port, "avalon")
    rec["hashrate_ths"] = _hashrate_ths(s, "5s")
    rec["hashrate_avg_ths"] = _hashrate_ths(s, "av")
    rec["uptime_s"] = int(_f(_first(s, "Elapsed"), 0))
    rec["accepted"] = int(_f(_first(s, "Accepted"), 0))
    rec["rejected"] = int(_f(_first(s, "Rejected"), 0))

    mm = None
    for block in _get_list(stats_resp, "STATS"):
        if isinstance(block, dict):
            for k, v in block.items():
                if k.startswith("MM ID") and isinstance(v, str):
                    mm = v
                    break
        if mm:
            break
    if mm:
        fields = dict(re.findall(r"(\w+)\[([^\]]*)\]", mm))
        mtmax = [_f(x) for x in fields.get("MTmax", "").split() if _f(x) is not None]
        mtavg = [_f(x) for x in fields.get("MTavg", "").split() if _f(x) is not None]
        rec["temp_c"] = max(mtavg) if mtavg else (
            max(mtmax) if mtmax else (_f(fields.get("TMax")) or _f(fields.get("Temp"))))
        rec["env_temp_c"] = _f(fields.get("Temp"))

        ver = fields.get("Ver", "")
        mnum = re.match(r"(\d+)", ver)
        rec["model"] = f"AvalonMiner {mnum.group(1)}" if mnum else (ver or None)

        ps = [_f(x) for x in fields.get("PS", "").split() if _f(x) is not None]
        watts = [p for p in ps if 800 <= p <= 6000]
        if watts:
            rec["power_w"] = round(max(watts), 1)
            rec["power_estimated"] = False
            rec["voltage_v"] = GRID_VOLTAGE
            rec["current_a"] = round(rec["power_w"] / GRID_VOLTAGE, 1)
            rec["volt_source"] = "AC"
        else:
            mpo = _f(fields.get("MPO"))
            if mpo and mpo > 0:
                rec["power_w"] = round(mpo, 1)
                rec["power_estimated"] = True

        fans = [int(_f(fields.get(f))) for f in ("Fan1", "Fan2", "Fan3", "Fan4")
                if _f(fields.get(f))]
        rec["fans_rpm"] = fans

        if rec["hashrate_ths"] is None:
            g = _f(fields.get("GHSavg")) or _f(fields.get("GHSmm"))
            if g:
                rec["hashrate_ths"] = round(g / 1000, 3)
        if rec["hashrate_avg_ths"] is None:
            g = _f(fields.get("GHSavg"))
            if g:
                rec["hashrate_avg_ths"] = round(g / 1000, 3)
    _apply_pool_socket(rec, pools_resp)
    return _finalize(rec)


# =================== CONTROLE DE POOLS ===================

def _aes_ecb_encrypt(data: bytes, key: bytes, zero_padding=False) -> bytes:
    pad_size = (16 - len(data) % 16) % 16 if zero_padding else (16 - len(data) % 16) or 16
    padding = b"\0" * pad_size if zero_padding else bytes([pad_size]) * pad_size
    encryptor = Cipher(algorithms.AES(key), modes.ECB()).encryptor()
    return encryptor.update(data + padding) + encryptor.finalize()


def _aes_ecb_decrypt(data: bytes, key: bytes) -> bytes:
    decryptor = Cipher(algorithms.AES(key), modes.ECB()).decryptor()
    return decryptor.update(data) + decryptor.finalize()


async def _set_antminer_pools(ip, credentials, pools):
    username, password = credentials["username"], credentials["password"]
    normalized = [{"url": p["url"], "user": p["worker"], "pass": p.get("password", "x")} for p in pools]
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            unlocked = await client.post(f"http://{ip}/api/v1/unlock", json={"pw": password})
            if unlocked.status_code == 200 and unlocked.json().get("token"):
                token = unlocked.json()["token"]
                response = await client.post(f"http://{ip}/api/v1/settings", headers={"Authorization": token}, json={"miner": {"pools": normalized}})
                response.raise_for_status()
                return "Pool alterada via API VNish."
    except Exception:
        pass

    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, auth=httpx.DigestAuth(username, password)) as client:
        response = await client.post(f"http://{ip}/cgi-bin/set_miner_conf.cgi", json={"pools": normalized})
        response.raise_for_status()
        if response.text.strip():
            try:
                body = response.json()
                if body.get("stats") == "fail" or body.get("status") == "error":
                    raise RuntimeError(body.get("error") or body.get("message") or "Firmware rejeitou a configuração.")
            except json.JSONDecodeError:
                pass
    return "Pool alterada via API Bitmain."


async def _set_avalon_pool(ip, port, credentials, pools):
    primary = pools[0]
    parameter = ",".join([credentials["username"], credentials["password"], primary["url"], primary["worker"], primary.get("password", "x")])
    async def ascset(value):
        reader, writer = await asyncio.wait_for(asyncio.open_connection(ip, port), timeout=SOCKET_TIMEOUT)
        try:
            writer.write(json.dumps({"command": "ascset", "parameter": value}).encode())
            await writer.drain()
            return await asyncio.wait_for(reader.read(8192), timeout=SOCKET_TIMEOUT)
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
    raw = await ascset(f"0,setpool,{parameter}")
    text = raw.decode("utf-8", errors="ignore").replace("\x00", "").strip()
    if not text or any(word in text.lower() for word in ("error", "failed", "denied")):
        raise RuntimeError(text or "Avalon não confirmou a alteração.")
    await ascset("0,reboot,0")
    return "Pool principal alterada; Avalon reiniciada para aplicar."


async def _set_whatsminer_v3(ip, credentials, pools):
    info = await _raw_socket_json(ip, 4433, {"cmd": "get.device.info"}, framed=True)
    if info.get("code") != 0 or not isinstance(info.get("msg"), dict) or not info["msg"].get("salt"):
        raise RuntimeError(info.get("msg") or "API v3 não forneceu o salt.")
    command = "set.miner.pools"
    ts = int(time.time())
    password = credentials["password"]
    digest = hashlib.sha256(f"{command}{password}{info['msg']['salt']}{ts}".encode()).digest()
    token = base64.b64encode(digest).decode()[:8]
    plain = json.dumps([{"pool": p["url"], "worker": p["worker"], "passwd": p.get("password", "x")} for p in pools], separators=(",", ":")).encode()
    encrypted = base64.b64encode(_aes_ecb_encrypt(plain, digest, zero_padding=True)).decode()
    response = await _raw_socket_json(ip, 4433, {"cmd": command, "ts": ts, "token": token, "account": credentials["username"], "param": encrypted}, framed=True)
    if response.get("code") != 0:
        raise RuntimeError(str(response.get("msg") or response.get("desc") or f"Código {response.get('code')}"))
    return "Pool alterada via API Whatsminer v3."


async def _set_whatsminer_v2(ip, port, credentials, pools):
    token_response = await api_call(ip, port, "get_token")
    token_data = token_response.get("Msg", token_response)
    if isinstance(token_data, str):
        parts = token_data.split()
        if len(parts) < 3:
            raise RuntimeError("Token v2 inválido.")
        token_data = {"time": parts[0], "salt": parts[1], "newsalt": parts[2]}
    salt, newsalt, token_time = str(token_data["salt"]), str(token_data["newsalt"]), str(token_data["time"])
    password_hash = md5_crypt.hash(credentials["password"], salt=salt).split("$")[-1]
    sign = md5_crypt.hash(password_hash + token_time, salt=newsalt).split("$")[-1]
    command = {"cmd": "update_pools", "token": sign}
    for index in range(3):
        pool = pools[index] if index < len(pools) else {"url": None, "worker": None, "password": None}
        command.update({f"pool{index + 1}": pool.get("url"), f"worker{index + 1}": pool.get("worker"), f"passwd{index + 1}": pool.get("password")})
    aes_key = hashlib.sha256(password_hash.encode()).digest()
    ciphertext = _aes_ecb_encrypt(json.dumps(command).encode(), aes_key, zero_padding=True)
    response = await _raw_socket_json(ip, port, {"enc": 1, "data": base64.b64encode(ciphertext).decode()})
    if "enc" in response and isinstance(response.get("enc"), str):
        response = json.loads(_aes_ecb_decrypt(base64.b64decode(response["enc"]), aes_key).rstrip(b"\0").decode())
    if response.get("Code") not in (131, "131") and response.get("STATUS") != "S":
        raise RuntimeError(str(response.get("Msg") or response.get("Description") or "API v2 rejeitou a configuração."))
    return "Pool alterada via API Whatsminer v2."


async def _set_whatsminer_pools(ip, port, credentials, pools):
    errors = []
    try:
        return await _set_whatsminer_v3(ip, credentials, pools)
    except Exception as error:
        errors.append(f"v3: {error}")
    try:
        return await _set_whatsminer_v2(ip, port, credentials, pools)
    except Exception as error:
        errors.append(f"v2: {error}")
    raise RuntimeError("; ".join(errors))


def _http_post_status_sync(url, timeout=HTTP_TIMEOUT):
    req = urllib.request.Request(url, method="POST", headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


async def _reboot_antminer(ip, credentials):
    """VNish exige o mesmo token de /api/v1/unlock usado pra trocar pool -
    reboot sem autenticacao (o que a versao anterior fazia) volta HTTP 405."""
    password = (credentials or {}).get("password")
    if password:
        try:
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
                unlocked = await client.post(f"http://{ip}/api/v1/unlock", json={"pw": password})
                if unlocked.status_code == 200 and unlocked.json().get("token"):
                    token = unlocked.json()["token"]
                    response = await client.post(f"http://{ip}/api/v1/reboot", headers={"Authorization": token})
                    if response.status_code in (200, 201, 202, 204):
                        return f"HTTP {response.status_code} (VNish autenticado)."
                    raise RuntimeError(f"VNish recusou o reboot autenticado (HTTP {response.status_code}).")
        except httpx.HTTPError as error:
            raise RuntimeError(f"Falha ao autenticar no VNish: {error}") from error
    # Firmware Bitmain padrao (nao-VNish) as vezes aceita sem autenticacao.
    status, _ = await asyncio.to_thread(lambda: _http_post_status_sync(f"http://{ip}/api/v1/reboot"))
    if status in (200, 201, 202, 204):
        return f"HTTP {status}"
    raise RuntimeError(f"HTTP {status} — confira a senha de acesso da ASIC.")


async def _reboot_whatsminer(ip, port):
    """BTMiner expoe 'reboot' como comando cgminer simples, sem exigir o canal
    cifrado com senha admin (esse so e necessario pra mexer em pool/carteira).
    E o mesmo caminho que ferramentas como o WhatsminerTool usam."""
    try:
        response = await api_call(ip, port, "reboot")
    except (asyncio.IncompleteReadError, ConnectionResetError, asyncio.TimeoutError, OSError) as e:
        return f"conexão encerrada após envio (reboot provável): {e}"
    status_list = _get_list(response, "STATUS")
    entry = status_list[0] if status_list else {}
    status_code = entry.get("STATUS")
    message = entry.get("Msg") or str(response)[:200]
    if status_code in ("S", "I") or not status_list:
        return f"Comando 'reboot' aceito: {message}" if status_list else "Comando 'reboot' enviado."
    raise RuntimeError(f"BTMiner recusou o reboot: {message}")


async def reboot_miner(miner, credentials=None):
    """Reinicia a maquina. Comando varia por fabricante.

    - Antminer (Vnish): autentica em /api/v1/unlock com a senha, depois reinicia
      com o token recebido (mesmo fluxo da troca de pool). Sem senha, tenta sem
      autenticacao (funciona em alguns firmwares Bitmain padrao).
    - Avalon (cgminer): comando socket 'restart' na porta 4028, sem autenticacao.
    - Whatsminer (BixBit): comando socket 'reboot' na porta 4028, sem autenticacao
      (mesma familia cgminer do Avalon) - trocar pool e diferente porque mexe na
      carteira de pagamento, por isso exige o canal cifrado com senha.

    Reboot derruba a conexao no meio: uma queda logo apos enviar normalmente
    significa que o comando foi aceito, entao tratamos isso como sucesso provavel.
    """
    ip = miner.get("ip")
    port = int(miner.get("port") or miner.get("protocol_port") or 4028)
    mtype = str(miner.get("type", "antminer")).lower()
    name = miner.get("name") or ip
    result = {"miner_id": miner.get("id"), "name": name, "success": False, "message": ""}

    try:
        if mtype == "antminer":
            message = await _reboot_antminer(ip, credentials)
            result.update(success=True, message=message)
        elif mtype == "avalon":
            try:
                await api_call(ip, port, "restart")
                result.update(success=True, message="comando 'restart' enviado")
            except (asyncio.IncompleteReadError, ConnectionResetError, asyncio.TimeoutError, OSError) as e:
                result.update(success=True, message=f"conexão encerrada após envio (reboot provável): {e}")
        elif mtype == "whatsminer":
            message = await _reboot_whatsminer(ip, port)
            result.update(success=True, message=message)
        else:
            result["message"] = f"Fabricante sem suporte: {mtype}"
    except Exception as error:
        result["message"] = str(error)[:500]
    return result


async def apply_pool_config(miner, credentials, pools):
    """Aplica até três pools em uma ASIC e devolve resultado sem credenciais."""
    name = miner.get("name") or miner.get("ip") or "Máquina"
    result = {"miner_id": miner.get("id"), "name": name, "success": False, "message": ""}
    try:
        ip = miner["ip"]
        port = int(miner.get("port") or miner.get("protocol_port") or 4028)
        mtype = str(miner.get("type", "antminer")).lower()
        if not credentials or not credentials.get("username") or not credentials.get("password"):
            raise ValueError("Credenciais ausentes.")
        if not pools:
            raise ValueError("Nenhuma pool informada.")
        if mtype == "antminer":
            message = await _set_antminer_pools(ip, credentials, pools)
        elif mtype == "whatsminer":
            message = await _set_whatsminer_pools(ip, port, credentials, pools)
        elif mtype == "avalon":
            message = await _set_avalon_pool(ip, port, credentials, pools)
        else:
            raise ValueError(f"Fabricante sem suporte: {mtype}")
        result.update(success=True, message=message)
    except Exception as error:
        result["message"] = str(error)[:500]
    return result


# =================== DISPATCH ===================

async def poll_miner(miner):
    name = miner.get("name") or miner["ip"]
    ip = miner["ip"]
    port = int(miner.get("port", 4028))
    mtype = miner.get("type", "antminer").lower()
    try:
        if mtype == "antminer":
            sj = await http_get_json(f"http://{ip}/api/v1/summary")
            return parse_antminer_vnish(name, ip, port, sj)

        if mtype == "whatsminer":
            summary = await api_call(ip, port, "summary")
            pools, devs = {}, {}
            try:
                pools = await api_call(ip, port, "pools")
            except Exception:
                pass
            try:
                devs = await api_call(ip, port, "devs")
            except Exception:
                pass
            return parse_whatsminer(name, ip, port, summary, pools, devs)

        if mtype == "avalon":
            summary = await api_call(ip, port, "summary")
            stats, pools = {}, {}
            try:
                stats = await api_call(ip, port, "estats")
            except Exception:
                pass
            try:
                pools = await api_call(ip, port, "pools")
            except Exception:
                pass
            return parse_avalon(name, ip, port, summary, stats, pools)

        # tipo desconhecido: tenta socket generico (cgminer padrao)
        summary = await api_call(ip, port, "summary")
        return parse_whatsminer(name, ip, port, summary, {})
    except Exception as e:
        return _offline_record(name, ip, port, mtype, e)
