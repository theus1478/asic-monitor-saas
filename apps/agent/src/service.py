"""Coletor sem interface para execução na rede local da fazenda."""
import asyncio
import json
import os
import socket
from datetime import datetime, timezone
from pathlib import Path

import httpx


def load_config() -> dict:
    path = Path(os.environ.get("ASIC_MONITOR_CONFIG", "config.json"))
    return json.loads(path.read_text(encoding="utf-8"))


def query_cgminer(miner: dict) -> dict:
    """Consulta a API local do minerador; falhas viram métrica offline."""
    try:
        with socket.create_connection((miner["host"], miner.get("port", 4028)), timeout=5) as connection:
            connection.sendall(b'{"command":"summary"}')
            raw = connection.recv(8192).rstrip(b"\x00")
        return {"name": miner["name"], "ip": miner["host"], "online": True, "raw": raw.decode("utf-8", "replace")}
    except OSError as error:
        return {"name": miner["name"], "ip": miner["host"], "online": False, "error": str(error)}


async def run() -> None:
    config = load_config()
    headers = {"Authorization": f"Bearer {config['agent_token']}"}
    interval = max(10, int(config.get("poll_interval_seconds", 30)))
    async with httpx.AsyncClient(timeout=15) as client:
        while True:
            metrics = [query_cgminer(miner) for miner in config.get("miners", [])]
            payload = {"observed_at": datetime.now(timezone.utc).isoformat(), "metrics": metrics}
            try:
                response = await client.post(config["api_url"], headers=headers, json=payload)
                response.raise_for_status()
            except httpx.HTTPError as error:
                print(f"Falha ao enviar métricas: {error}", flush=True)
            await asyncio.sleep(interval)


if __name__ == "__main__":
    asyncio.run(run())
