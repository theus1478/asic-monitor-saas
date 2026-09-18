"""Túnel de acesso remoto: o coletor abre uma conexão de SAÍDA (WebSocket) com o relay
e atende as requisições HTTP que o navegador do cliente faz à tela da ASIC.

Segurança: o coletor nunca usa o destino que vem no quadro. O IP/porta é sempre o da
máquina cadastrada na PRÓPRIA fazenda (lista recebida da nuvem), localizada pelo
`miner_id`; qualquer outro id é recusado. Nada além do HTTP na porta web da ASIC é acessível.
"""

from __future__ import annotations

import asyncio
import base64
import ipaddress
import json
import re
from typing import Callable

import httpx
from websockets.asyncio.client import connect

MAX_BODY_BYTES = 10 * 1024 * 1024
UPSTREAM_TIMEOUT = 25.0
MAX_CONCURRENT = 8
RECONNECT_MIN = 3.0
RECONNECT_MAX = 60.0
WS_MAX_SIZE = 24 * 1024 * 1024

# Cabeçalhos que não vão do relay para a ASIC (hop-by-hop, informações do proxy reverso, recalculados).
_DROP_REQUEST = {
    "host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer",
    "transfer-encoding", "upgrade", "content-length", "accept-encoding", "forwarded", "x-real-ip",
}
# Cabeçalhos da resposta que o coletor recalcula (o corpo já vem decodificado por `aiter_bytes`).
_DROP_RESPONSE = {"connection", "keep-alive", "transfer-encoding", "content-length", "content-encoding", "upgrade"}
_BAD_PATH = re.compile(r"[\s\x00-\x1f\x7f]")


class TunnelError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _origin(ip: str, port: int) -> str:
    return f"http://{ip}" if port == 80 else f"http://{ip}:{port}"


def find_miner(miners: list[dict], miner_id: str) -> dict | None:
    for miner in miners:
        if miner.get("id") == miner_id and miner.get("enabled", True):
            return miner
    return None


def build_upstream_request(miner: dict, frame: dict) -> tuple[str, str, dict[str, str], bytes]:
    """Valida o quadro e devolve (método, url, cabeçalhos, corpo). Levanta TunnelError se algo não for permitido."""
    ip = str(miner.get("ip", ""))
    try:
        ipaddress.ip_address(ip)  # só IP literal: nada de nome de host / resolução de DNS
    except ValueError:
        raise TunnelError("forbidden", "Máquina sem IP válido.") from None
    port = int(miner.get("web_port") or 80)
    if not 1 <= port <= 65535:
        raise TunnelError("forbidden", "Porta inválida.")

    method = str(frame.get("method", "GET")).upper()
    if method not in {"GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"}:
        raise TunnelError("forbidden", "Método não permitido.")
    path = str(frame.get("path", "/"))
    if not path.startswith("/") or _BAD_PATH.search(path):
        raise TunnelError("forbidden", "Caminho inválido.")

    upstream_origin = _origin(ip, port)
    public_origin = str(frame.get("public_origin") or "")
    headers: dict[str, str] = {}
    for name, value in (frame.get("headers") or {}).items():
        lower = str(name).lower()
        if lower in _DROP_REQUEST or lower.startswith("x-forwarded-"):
            continue
        value = str(value)
        if lower in ("origin", "referer") and public_origin and value.startswith(public_origin):
            value = upstream_origin + value[len(public_origin):]
        headers[lower] = value
    headers["host"] = upstream_origin[len("http://"):]
    headers["accept-encoding"] = "identity"

    try:
        body = base64.b64decode(frame.get("body_b64") or "", validate=True)
    except ValueError:
        raise TunnelError("bad_request", "Corpo inválido.") from None
    if len(body) > MAX_BODY_BYTES:
        raise TunnelError("too_large", "Corpo grande demais.")
    return method, f"{upstream_origin}{path}", headers, body


async def fetch_from_miner(client: httpx.AsyncClient, miner: dict, frame: dict) -> dict:
    method, url, headers, body = build_upstream_request(miner, frame)
    try:
        async with client.stream(method, url, headers=headers, content=body or None, follow_redirects=False, timeout=UPSTREAM_TIMEOUT) as response:
            chunks: list[bytes] = []
            size = 0
            async for chunk in response.aiter_bytes():
                size += len(chunk)
                if size > MAX_BODY_BYTES:
                    raise TunnelError("too_large", "Resposta grande demais.")
                chunks.append(chunk)
            out_headers = [[name, value] for name, value in response.headers.multi_items() if name.lower() not in _DROP_RESPONSE]
            return {"status": response.status_code, "headers": out_headers, "body_b64": base64.b64encode(b"".join(chunks)).decode("ascii")}
    except httpx.TimeoutException:
        raise TunnelError("timeout", "A ASIC não respondeu a tempo.") from None
    except httpx.HTTPError as error:
        raise TunnelError("unreachable", f"Não foi possível falar com a ASIC: {error.__class__.__name__}") from None


class Tunnel:
    """Mantém o WebSocket com o relay enquanto o acesso remoto estiver ligado para a fazenda.

    `get_state()` devolve {"enabled": bool, "relay_url": str, "token": str, "miners": list, "stopped": bool},
    lido de novo a cada ciclo (a lista de máquinas e o interruptor mudam pela nuvem)."""

    def __init__(self, get_state: Callable[[], dict], emit: Callable[[str, str], None]):
        self._get_state = get_state
        self._emit = emit  # emit(estado, mensagem) — estado: off | connecting | connected | error
        self._client: httpx.AsyncClient | None = None

    async def run(self) -> None:
        delay = RECONNECT_MIN
        async with httpx.AsyncClient() as client:
            self._client = client
            while not self._get_state().get("stopped"):
                state = self._get_state()
                if not state.get("enabled") or not state.get("relay_url"):
                    self._emit("off", "Acesso remoto desligado")
                    await asyncio.sleep(5)
                    continue
                self._emit("connecting", "Conectando ao acesso remoto...")
                try:
                    async with connect(
                        state["relay_url"],
                        additional_headers={"Authorization": f"Bearer {state['token']}"},
                        max_size=WS_MAX_SIZE,
                        open_timeout=15,
                        ping_interval=20,
                        ping_timeout=25,
                    ) as ws:
                        delay = RECONNECT_MIN
                        self._emit("connected", "Acesso remoto conectado")
                        await self._serve(ws)
                    self._emit("error", "Acesso remoto desconectado")
                except asyncio.CancelledError:
                    raise
                except Exception as error:  # rede fora, relay reiniciando, token recusado...
                    self._emit("error", f"Acesso remoto sem conexão ({error.__class__.__name__})")
                await asyncio.sleep(delay)
                delay = min(delay * 2, RECONNECT_MAX)

    async def _serve(self, ws) -> None:
        semaphore = asyncio.Semaphore(MAX_CONCURRENT)
        tasks: set[asyncio.Task] = set()

        async def watch() -> None:
            # Fecha a conexão se o acesso remoto for desligado ou o coletor parado.
            while True:
                await asyncio.sleep(5)
                state = self._get_state()
                if state.get("stopped") or not state.get("enabled"):
                    await ws.close()
                    return

        watcher = asyncio.create_task(watch())
        try:
            async for raw in ws:
                try:
                    frame = json.loads(raw)
                except ValueError:
                    continue
                if not isinstance(frame, dict) or frame.get("t") != "req" or not frame.get("id"):
                    continue
                task = asyncio.create_task(self._handle(ws, frame, semaphore))
                tasks.add(task)
                task.add_done_callback(tasks.discard)
        finally:
            watcher.cancel()
            for task in tasks:
                task.cancel()

    async def _handle(self, ws, frame: dict, semaphore: asyncio.Semaphore) -> None:
        request_id = frame["id"]
        async with semaphore:
            try:
                miner = find_miner(self._get_state().get("miners", []), str(frame.get("miner_id", "")))
                if miner is None:
                    raise TunnelError("forbidden", "Máquina não pertence a esta fazenda.")
                assert self._client is not None
                reply = await fetch_from_miner(self._client, miner, frame)
                message = {"t": "res", "id": request_id, **reply}
            except TunnelError as error:
                message = {"t": "err", "id": request_id, "code": error.code, "message": error.message}
            except asyncio.CancelledError:
                raise
            except Exception as error:
                message = {"t": "err", "id": request_id, "code": "agent_error", "message": error.__class__.__name__}
            try:
                await ws.send(json.dumps(message))
            except Exception:
                pass  # a conexão caiu; o relay já falhou a requisição pendente
