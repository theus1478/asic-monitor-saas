"""
Clientes de API por fabricante, somente leitura:

- Antminer  -> Vnish, via API HTTP  http://IP/api/v1/summary
               (traz power_consumption medido; alguns modelos devolvem 0 e caem
                pra estimativa por eficiencia W/TH). Quando a maquina nao tem
                VNish instalado (firmware original bmminer - inclui placas
                controladoras AML, Xil e BB), cai pro socket 4028 padrao cgminer
                (ver parse_antminer_stock).
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

# Chaves de temperatura/fan no bloco STATS variam por modelo/versao de firmware
# do bmminer (temp1, temp2_1, temp3_3... / fan1, fan2...) - casar pelo padrao
# em vez de um layout fixo, ja que nao ha um schema unico documentado.
_STOCK_TEMP_KEY = re.compile(r"^temp\d")
_STOCK_FAN_KEY = re.compile(r"^fan\d+$", re.IGNORECASE)

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
        "temp_c": None, "env_temp_c": None, "fans_rpm": [], "boards": [],
        "cooling_mode": None, "cooling_inferred": False,
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
    # Antminer (Bitmain) nao reporta tensao/corrente na API - nao inventar um
    # valor sintetico pra ela. Avalon reporta de verdade (via PS[], ver parse_avalon).
    if rec.get("type") == "avalon" and rec.get("power_w") and rec["power_w"] > 0 and rec.get("voltage_v") is None:
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


# =================== WHATSMINER: PAINEL LUCI (firmware original, sem API no socket 4028) ===================
#
# Algumas versoes do firmware original da Whatsminer (BTMiner) desativam por
# padrao a API classica do socket 4028 (a mesma familia cgminer que Avalon e
# BixBit usam) - a conexao ate abre, mas fecha sem responder ao comando. Nessas
# maquinas o unico jeito de monitorar e a propria pagina HTML do painel local
# (LuCI, framework do OpenWrt), que a Whatsminer usa em
# /cgi-bin/luci/admin/status/btminerstatus. NAO e uma API documentada - o
# layout foi obtido de uma captura real do painel (ver apps/agent/README.md),
# pode variar entre versoes de firmware.

_LUCI_FIELDSET_RE = re.compile(r'<fieldset class="cbi-section"[^>]*>(.*?)</fieldset>', re.DOTALL)
_LUCI_LEGEND_RE = re.compile(r"<legend>([^<]*)</legend>")
_LUCI_FIELD_RE = re.compile(r'id="cbid\.table\.(\d+)\.(\w+)"\s+value="([^"]*)"')


def _luci_unescape(value):
    return value.replace("&#39;", "'").replace("&quot;", '"').replace("&amp;", "&")


def _luci_parse_sections(html):
    """{nome_da_secao: [linha1_dict, linha2_dict, ...]}. Secoes sem <legend>
    (ex.: a tabela de temperatura por placa) viram "_unnamed_{indice}" - o
    layout dessa pagina segue sempre a mesma ordem de fieldsets."""
    sections = {}
    for index, block in enumerate(_LUCI_FIELDSET_RE.findall(html)):
        legend = _LUCI_LEGEND_RE.search(block)
        name = legend.group(1).strip() if legend else f"_unnamed_{index}"
        rows = {}
        for row_id, field, value in _LUCI_FIELD_RE.findall(block):
            rows.setdefault(row_id, {})[field] = _luci_unescape(value)
        sections[name] = list(rows.values())
    return sections


def _luci_num(value):
    if value is None:
        return None
    return _f(str(value).replace(",", ""))


def _luci_elapsed_seconds(text):
    """'2m 36s' / '1h 5m 12s' / '3d 2h' -> segundos."""
    if not text:
        return 0
    total = 0
    for amount, unit in re.findall(r"(\d+)\s*([dhms])", str(text)):
        total += int(amount) * {"d": 86400, "h": 3600, "m": 60, "s": 1}[unit]
    return total


async def _luci_login(ip, username, password):
    """Login no LuCI - devolve o cookie de sessao (sysauth) ou None se falhar.
    NAO CONFIRMADO contra hardware real (nomes de campo do formulario e do
    cookie sao os padroes do LuCI/OpenWrt, mas essa build pode customizar)."""
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=False) as client:
        response = await client.post(f"http://{ip}/cgi-bin/luci/", data={"luci_username": username, "luci_password": password})
        for name, value in response.cookies.items():
            if name.startswith("sysauth"):
                return name, value
    return None


async def _luci_fetch_status(ip):
    """Tenta logar com as credenciais padrao (admin/admin, depois root/root -
    mesmo padrao ja usado nos comandos de troca de pool/reboot) e buscar a
    pagina de status. Devolve None se nada funcionar, sem levantar excecao -
    quem chama decide o que fazer (cair pra offline, por ex.)."""
    for username, password in (("admin", "admin"), ("root", "root")):
        try:
            session = await _luci_login(ip, username, password)
            if not session:
                continue
            cookie_name, cookie_value = session
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, cookies={cookie_name: cookie_value}) as client:
                response = await client.get(f"http://{ip}/cgi-bin/luci/admin/status/btminerstatus")
                if response.status_code == 200 and "cbi-table" in response.text:
                    return response.text
        except Exception:
            continue
    return None


def parse_whatsminer_luci(name, ip, port, html):
    rec = _base_record(name, ip, port, "whatsminer")
    sections = _luci_parse_sections(html)

    summary_rows = sections.get("Summary") or []
    s = summary_rows[0] if summary_rows else {}
    rec["hashrate_avg_ths"] = _luci_num(s.get("thsav"))
    rec["hashrate_ths"] = rec["hashrate_avg_ths"]
    rec["uptime_s"] = _luci_elapsed_seconds(s.get("elapsed"))
    rec["accepted"] = int(_luci_num(s.get("accepted")) or 0)
    rec["rejected"] = int(_luci_num(s.get("rejected")) or 0)
    power = _luci_num(s.get("power"))
    if power and power > 0:
        rec["power_w"] = round(power, 1)
        rec["power_estimated"] = False
    if str(s.get("liquid_cool", "")).lower() == "true":
        rec["cooling_mode"] = "immersion"
        rec["cooling_inferred"] = False

    device_rows = [r for r in (sections.get("Devices") or []) if str(r.get("name", "")).upper() != "TOTAL"]
    temp_by_board = {r.get("name"): r for r in (sections.get("_unnamed_2") or [])}
    boards, temps = [], []
    for dv in device_rows:
        board_name = dv.get("name", "")
        chip_temp = _luci_num(temp_by_board.get(board_name, {}).get("temp"))
        if chip_temp:
            temps.append(chip_temp)
        boards.append({"name": board_name, "chip_temp_c": chip_temp, "pcb_temp_c": None, "hashrate_ths": _luci_num(dv.get("thsav"))})
    rec["boards"] = boards
    if temps:
        rec["temp_c"] = round(max(temps), 1)

    pool_rows = sections.get("Pools") or []
    chosen = next((p for p in pool_rows if str(p.get("stratumactive", "")).lower() == "true" and str(p.get("status", "")).lower() == "alive"), None)
    if not chosen and pool_rows:
        chosen = pool_rows[0]
    if chosen:
        rec["pool"] = chosen.get("url")
        rec["worker"] = chosen.get("user")

    if not rec.get("power_w"):
        w, est = _estimate_power(rec.get("model"), rec.get("hashrate_avg_ths") or rec.get("hashrate_ths"))
        if w:
            rec["power_w"] = w
            rec["power_estimated"] = est

    return _finalize(rec)


# =================== PARSERS ===================

def _ws_msg_dict(resp):
    """"get_version"/"get_psu" (API oficial documentada, ver manual BTMiner)
    devolvem o corpo direto em "Msg" (dict), sem o embrulho de lista do
    "devs"/"summary" - helper separado de _get_list por causa disso."""
    m = (resp or {}).get("Msg")
    return m if isinstance(m, dict) else {}


def parse_whatsminer(name, ip, port, summary_resp, pools_resp, devs_resp=None,
                      version_resp=None, edevs_resp=None, get_version_resp=None, psu_resp=None):
    s = _summary0(summary_resp)
    rec = _base_record(name, ip, port, "whatsminer")
    rec["hashrate_avg_ths"] = _pick_hashrate(
        s, ["MHS av", "GHS av", "THS av", "MHS 15m", "HS RT"])
    # "edevs" e o comando documentado pela MicroBT pra hashboard (ver manual
    # oficial da API BTMiner) - "devs" e o nome classico cgminer que o BixBit
    # tambem atende; tenta os dois, edevs primeiro (mais completo no firmware
    # original).
    board_source = edevs_resp if _get_list(edevs_resp or {}, "DEVS") else devs_resp
    inst_boards = _ws_board_hashrate_sum(board_source, ["MHS 5s", "HS RT", "MHS av"])
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
    if not rec["model"]:
        # "version" (cgminer classico) nao e o comando documentado pela
        # MicroBT pro modelo - o certo e "get_version" (campo "miner_type",
        # ver manual oficial). Mantem os dois: "version" cobre firmware que
        # aceite o nome classico, "get_version" e o documentado.
        v_list = _get_list(version_resp or {}, "VERSION")
        v0 = v_list[0] if v_list else {}
        rec["model"] = _first(v0, "Type", "Miner Type", "Model", "PROD")
    if not rec["model"]:
        rec["model"] = _ws_msg_dict(get_version_resp).get("miner_type")
    temps = [t for t in (_f(_first(s, "Chip Temp Max")),
                         _f(_first(s, "Temperature")),
                         _ws_temp_from_devs(board_source)) if t and t > 0]
    rec["temp_c"] = round(max(temps), 1) if temps else None
    rec["env_temp_c"] = _f(_first(s, "Env Temp", "Env Temperature"))
    # temperatura por hashboard - nomes de campo padrao primeiro; se um
    # firmware nao usar "Chip Temp Max"/"Temperature", casa por padrao
    # generico (temp1, temp2_1...) igual ao fallback do Antminer sem VNish,
    # ja que nao ha um schema unico documentado pra todo firmware Whatsminer.
    boards = []
    for i, dv in enumerate(_get_list(board_source or {}, "DEVS")):
        chip_temp = _f(dv.get("Chip Temp Max"))
        pcb_temp = _f(dv.get("Temperature"))
        if chip_temp is None and pcb_temp is None:
            generic_temps = [_f(v) for k, v in dv.items() if _STOCK_TEMP_KEY.match(str(k))]
            generic_temps = [t for t in generic_temps if t and t > 0]
            if generic_temps:
                chip_temp = max(generic_temps)
        if chip_temp is None:
            # "edevs" (API oficial) so expoe uma leitura por placa
            # ("Temperature", temperatura na saida de ar) - sem "Chip Temp
            # Max" (exclusivo do BixBit), usa essa mesma leitura.
            chip_temp = pcb_temp
        boards.append({
            "name": f"Placa {dv.get('Slot', dv.get('ASC', i))}",
            "chip_temp_c": chip_temp,
            "pcb_temp_c": pcb_temp,
            "hashrate_ths": _normalize_hashrate(dv.get("MHS av")),
        })
    rec["boards"] = boards
    if rec["temp_c"] is None:
        board_temps = [b["chip_temp_c"] for b in boards if b["chip_temp_c"]]
        if board_temps:
            rec["temp_c"] = round(max(board_temps), 1)
    fan_in = _f(_first(s, "Fan Speed In"))
    fan_out = _f(_first(s, "Fan Speed Out"))
    if fan_in is None and fan_out is None:
        # Alguns firmwares originais numeram como fan1/fan2 em vez de "Fan
        # Speed In/Out" - mesmo padrao generico usado no fallback do Antminer.
        rec["fans_rpm"] = [f for k, v in s.items() if _STOCK_FAN_KEY.match(str(k)) and (f := _f(v)) is not None]
    else:
        # Filtra por "is not None", nao por valor truthy - 0 RPM e um dado
        # legitimo (imersao), nao ausencia de leitura.
        rec["fans_rpm"] = [x for x in (fan_in, fan_out) if x is not None]
    # Nenhum firmware Whatsminer conhecido expoe um campo de "modo"; inferimos
    # pela rotacao dos fans: fans girando = ar; fans zerados = imersao.
    if rec["fans_rpm"]:
        rec["cooling_mode"] = "air" if max(rec["fans_rpm"]) > 100 else "immersion"
        rec["cooling_inferred"] = True
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
    # "get_psu" e o comando documentado pela MicroBT pra fonte real (ver
    # manual oficial) - o BixBit ja cobre isso com "PSU Vin0/Iin0" no
    # "summary" (acima), mas o firmware original so expoe essa leitura por
    # esse comando separado. "vin" vem em unidades de 10mV e "iin" em mA.
    psu = _ws_msg_dict(psu_resp)
    if psu:
        if not rec.get("power_w"):
            pin = _f(psu.get("pin"))
            if pin and pin > 0:
                rec["power_w"] = round(pin, 1)
                rec["power_estimated"] = False
        if rec.get("voltage_v") is None:
            psu_vin = _f(psu.get("vin"))
            psu_iin = _f(psu.get("iin"))
            if psu_vin and psu_vin > 0:
                rec["voltage_v"] = round(psu_vin / 100, 1)
            if psu_iin and psu_iin > 0:
                rec["current_a"] = round(psu_iin / 1000, 2)
            if rec.get("voltage_v") is not None:
                rec["volt_source"] = "AC (PSU)"
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

    # Firmware original (BTMiner) normalmente nao expoe PSU/potencia real pelo
    # socket cgminer (isso e um adicional do BixBit) - sem consumo medido,
    # cai pra estimativa por eficiencia W/TH, igual ja acontece pro Antminer.
    if not rec.get("power_w"):
        w, est = _estimate_power(rec["model"], rec.get("hashrate_avg_ths") or rec.get("hashrate_ths"))
        if w:
            rec["power_w"] = w
            rec["power_estimated"] = est

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
    # temperatura por hashboard (via chains)
    boards = []
    for i, c in enumerate(m.get("chains", [])):
        cct = c.get("chip_temp") or {}
        cpt = c.get("pcb_temp") or {}
        boards.append({
            "name": f"Placa {c.get('id', i)}",
            "chip_temp_c": _f(cct.get("max")),
            "pcb_temp_c": _f(cpt.get("max")),
            "hashrate_ths": _normalize_hashrate(c.get("hashrate_rt")),
        })
    rec["boards"] = boards
    chip_maxes = [b["chip_temp_c"] for b in boards if b["chip_temp_c"]]
    if chip_maxes:
        rec["temp_c"] = max(chip_maxes)
    fans = [int(_f(f.get("rpm"), 0)) for f in (m.get("cooling", {}).get("fans") or [])
            if _f(f.get("rpm"))]
    rec["fans_rpm"] = fans
    # modo de refrigeracao: declarado pelo firmware (cooling.settings.mode.name)
    mode = (((m.get("cooling") or {}).get("settings") or {}).get("mode") or {}).get("name")
    if mode:
        rec["cooling_mode"] = str(mode).lower()  # ex.: immersion, air, hydro
        rec["cooling_inferred"] = False
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
    # Bitmain nao reporta tensao/corrente na API do VNish - nao inventar um
    # valor sintetico (230V nominal) pra parecer leitura real.

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


def parse_antminer_stock(name, ip, port, summary_resp, stats_resp, pools_resp):
    """Antminer com firmware original (bmminer), sem VNish instalado - fala o
    mesmo socket cgminer padrao (porta 4028) que Whatsminer e Avalon usam, so
    que com os nomes de campo do Bitmain. Cobre qualquer placa controladora
    (AML, Xil, BB) que nao exponha a API HTTP do VNish (ver poll_miner)."""
    s = _summary0(summary_resp)
    rec = _base_record(name, ip, port, "antminer")
    rec["hashrate_ths"] = _pick_hashrate(s, ["GHS 5s", "MHS 5s", "GHS av", "MHS av"])
    rec["hashrate_avg_ths"] = _pick_hashrate(s, ["GHS av", "MHS av"])
    rec["uptime_s"] = int(_f(_first(s, "Elapsed"), 0))
    rec["accepted"] = int(_f(_first(s, "Accepted"), 0))
    rec["rejected"] = int(_f(_first(s, "Rejected"), 0))

    model, temps, fans = None, [], []
    for block in _get_list(stats_resp, "STATS"):
        if not isinstance(block, dict):
            continue
        model = model or block.get("Type")
        for key, value in block.items():
            v = _f(value)
            if v is None or v <= 0:
                continue
            if _STOCK_TEMP_KEY.match(key):
                temps.append(v)
            elif _STOCK_FAN_KEY.match(key):
                fans.append(v)
    rec["model"] = model
    rec["temp_c"] = max(temps) if temps else None
    rec["fans_rpm"] = fans

    # Bitmain (com ou sem VNish) nao expoe consumo real no firmware original -
    # so estimativa por eficiencia W/TH, igual ao caminho VNish quando o
    # power_consumption vem zerado.
    w, est = _estimate_power(rec["model"], rec.get("hashrate_avg_ths") or rec["hashrate_ths"])
    rec["power_w"] = w
    rec["power_estimated"] = est

    _apply_pool_socket(rec, pools_resp)
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

        # temperatura por hashboard: media (MTavg) como principal (bate com a
        # interface do 1246), maxima (MTmax) como secundario.
        boards = []
        mghs = [_f(x) for x in fields.get("MGHS", "").split() if _f(x) is not None]
        board_count = max(len(mtavg), len(mtmax))
        for i in range(board_count):
            avg_t = mtavg[i] if i < len(mtavg) else None
            max_t = mtmax[i] if i < len(mtmax) else None
            boards.append({
                "name": f"H{i}",
                "chip_temp_c": avg_t if avg_t is not None else max_t,
                "pcb_temp_c": max_t,
                "hashrate_ths": round(mghs[i] / 1000, 2) if i < len(mghs) else None,
            })
        rec["boards"] = boards

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
        if fans:
            rec["cooling_mode"] = "air" if max(fans) > 100 else "immersion"
            rec["cooling_inferred"] = True

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
                response = await client.post(f"http://{ip}/api/v1/settings", headers={"Authorization": f"Bearer {token}"}, json={"miner": {"pools": normalized}})
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
    """Confirmado via captura de rede da propria interface do VNish: o endpoint
    e /api/v1/system/reboot (nao /api/v1/reboot) e o header e "Bearer <token>"
    (nao so o token cru) - as duas coisas que a versao anterior errava."""
    password = (credentials or {}).get("password")
    if password:
        try:
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
                unlocked = await client.post(f"http://{ip}/api/v1/unlock", json={"pw": password})
                if unlocked.status_code == 200 and unlocked.json().get("token"):
                    token = unlocked.json()["token"]
                    response = await client.post(f"http://{ip}/api/v1/system/reboot", headers={"Authorization": f"Bearer {token}"})
                    if response.status_code in (200, 201, 202, 204):
                        return f"HTTP {response.status_code} (VNish autenticado)."
                    raise RuntimeError(f"VNish recusou o reboot autenticado (HTTP {response.status_code}).")
        except httpx.HTTPError as error:
            raise RuntimeError(f"Falha ao autenticar no VNish: {error}") from error
    # Firmware Bitmain padrao (nao-VNish) as vezes aceita sem autenticacao.
    status, _ = await asyncio.to_thread(lambda: _http_post_status_sync(f"http://{ip}/api/v1/system/reboot"))
    if status in (200, 201, 202, 204):
        return f"HTTP {status}"
    raise RuntimeError(f"HTTP {status} — confira a senha de acesso da ASIC.")


async def _reboot_whatsminer(ip, port):
    """Tentativa: 'reboot' como comando cgminer simples, sem exigir o canal
    cifrado com senha admin (esse so e necessario pra mexer em pool/carteira).
    NAO CONFIRMADO contra hardware real - se o BTMiner nao devolver um STATUS
    reconhecivel, tratamos como falha (em vez de assumir sucesso as cegas) e
    devolvemos a resposta crua pra ajudar a descobrir o comando certo."""
    try:
        response = await api_call(ip, port, "reboot")
    except (asyncio.IncompleteReadError, ConnectionResetError, asyncio.TimeoutError, OSError) as e:
        return f"conexão encerrada após envio (reboot provável): {e}"
    status_list = _get_list(response, "STATUS")
    if not status_list:
        raise RuntimeError(f"BTMiner não confirmou o reboot — resposta: {str(response)[:300]}")
    entry = status_list[0]
    status_code = entry.get("STATUS")
    message = entry.get("Msg") or str(response)[:200]
    if status_code in ("S", "I"):
        return f"Comando 'reboot' aceito: {message}"
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


async def _stop_mining_cgminer(ip, port):
    """Comando 'ascdisable' da API cgminer padrao - desativa o(s) ASC sem
    matar o processo (diferente de 'quit', que derrubaria a API inteira e
    exigiria acesso fisico/reboot pra voltar). Mesma familia de socket usada
    por reboot/restart em Avalon e Whatsminer; em Antminer so funciona se o
    firmware expuser essa API (nem todo modo do VNish expoe)."""
    reader, writer = await asyncio.wait_for(asyncio.open_connection(ip, port), timeout=SOCKET_TIMEOUT)
    try:
        writer.write(json.dumps({"command": "ascdisable", "parameter": "0"}).encode())
        await writer.drain()
        raw = await asyncio.wait_for(reader.read(8192), timeout=SOCKET_TIMEOUT)
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
    text = raw.decode("utf-8", errors="ignore").replace("\x00", "").strip()
    if not text or any(word in text.lower() for word in ("error", "unknown", "invalid")):
        raise RuntimeError(text or "API não confirmou o comando.")
    return f"Comando 'ascdisable' aceito: {text[:200]}"


async def stop_mining_miner(miner, credentials=None):
    """Para a mineracao sem reiniciar a maquina, via API cgminer padrao (porta
    4028). NAO CONFIRMADO contra hardware real em todos os firmwares - alguns
    modos do VNish (Antminer) nao expoem essa API, so a HTTP. Quando falha,
    devolve mensagem clara em vez de fingir sucesso; reiniciar a maquina
    sempre retoma a mineracao."""
    ip = miner.get("ip")
    port = int(miner.get("port") or miner.get("protocol_port") or 4028)
    name = miner.get("name") or ip
    result = {"miner_id": miner.get("id"), "name": name, "success": False, "message": ""}
    try:
        message = await _stop_mining_cgminer(ip, port)
        result.update(success=True, message=message)
    except Exception as error:
        result["message"] = (
            f"{error} — o comando usa a API cgminer padrão (porta 4028); "
            "se este firmware não a expõe, parar a mineração remotamente não é "
            "possível ainda. Reiniciar a máquina sempre retoma a mineração."
        )[:500]
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
            try:
                sj = await http_get_json(f"http://{ip}/api/v1/summary")
                return parse_antminer_vnish(name, ip, port, sj)
            except Exception:
                pass
            # Sem VNish (firmware original bmminer - inclui placas AML, Xil e
            # BB): mesmo socket cgminer padrao usado por Whatsminer/Avalon.
            summary = await api_call(ip, port, "summary")
            stats, pools = {}, {}
            try:
                stats = await api_call(ip, port, "stats")
            except Exception:
                pass
            try:
                pools = await api_call(ip, port, "pools")
            except Exception:
                pass
            return parse_antminer_stock(name, ip, port, summary, stats, pools)

        if mtype == "whatsminer":
            rec = None
            try:
                summary = await api_call(ip, port, "summary")
                pools, devs, version, edevs, get_version, psu = {}, {}, {}, {}, {}, {}
                try:
                    pools = await api_call(ip, port, "pools")
                except Exception:
                    pass
                try:
                    devs = await api_call(ip, port, "devs")
                except Exception:
                    pass
                try:
                    version = await api_call(ip, port, "version")
                except Exception:
                    pass
                # "edevs"/"get_version"/"get_psu" sao os comandos documentados
                # pela MicroBT no manual oficial da API BTMiner (porta 4028,
                # mesmo socket) - "devs"/"version" acima sao os nomes cgminer
                # classicos que o BixBit tambem atende. Tenta os dois jogos de
                # comando; parse_whatsminer prioriza o oficial quando presente.
                try:
                    edevs = await api_call(ip, port, "edevs")
                except Exception:
                    pass
                try:
                    get_version = await api_call(ip, port, "get_version")
                except Exception:
                    pass
                try:
                    psu = await api_call(ip, port, "get_psu")
                except Exception:
                    pass
                rec = parse_whatsminer(name, ip, port, summary, pools, devs, version, edevs, get_version, psu)
            except Exception:
                rec = None

            # Alguns firmwares originais respondem "summary" so com hashrate
            # (sem os campos de PSU/temperatura/pool do BixBit, e sem "devs"
            # nem "pools" tambem responderem) - nesse caso rec fica incompleto,
            # nao vazio, entao nao da pra decidir so pela presenca de hashrate
            # se ainda vale a pena tentar o painel LuCI. Sempre que faltar
            # temperatura, consumo real ou pool, busca o LuCI tambem e
            # completa so o que faltou, sem descartar o que o socket ja
            # trouxe (hashrate/uptime via socket costumam ser mais recentes).
            incomplete = (
                rec is None
                or not (rec.get("hashrate_ths") or rec.get("hashrate_avg_ths"))
                or rec.get("temp_c") is None
                or not rec.get("pool")
                or rec.get("power_estimated")
            )
            if incomplete:
                html = await _luci_fetch_status(ip)
                if html:
                    luci_rec = parse_whatsminer_luci(name, ip, port, html)
                    if rec is None:
                        rec = luci_rec
                    else:
                        fallback_fields = (
                            "temp_c", "env_temp_c", "voltage_v", "current_a",
                            "volt_source", "pool", "worker", "cooling_mode",
                            "cooling_inferred", "model",
                        )
                        for key in fallback_fields:
                            if rec.get(key) in (None, "") and luci_rec.get(key) not in (None, ""):
                                rec[key] = luci_rec[key]
                        if not rec.get("boards") and luci_rec.get("boards"):
                            rec["boards"] = luci_rec["boards"]
                        if rec.get("power_estimated") and not luci_rec.get("power_estimated") and luci_rec.get("power_w"):
                            rec["power_w"] = luci_rec["power_w"]
                            rec["power_estimated"] = False
                        rec = _finalize(rec)

            if rec is not None and (rec.get("hashrate_ths") or rec.get("hashrate_avg_ths")):
                return rec
            raise RuntimeError("Sem resposta da API cgminer (porta 4028) nem do painel LuCI (HTTP).")

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
