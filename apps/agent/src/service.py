"""Coletor sem interface para execução na rede local da fazenda."""
import asyncio
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import httpx

from miners import poll_miner


def load_config() -> dict:
    path = Path(os.environ.get("ASIC_MONITOR_CONFIG", "config.json"))
    return json.loads(path.read_text(encoding="utf-8"))


def config_url_from_api_url(api_url: str) -> str:
    """A API de métricas e a de configuração vivem na mesma base; deriva uma da outra."""
    if api_url.endswith("/metrics"):
        return api_url[: -len("/metrics")] + "/config"
    return api_url.rstrip("/") + "/config"


async def fetch_remote_miners(client: httpx.AsyncClient, config_url: str, headers: dict) -> list | None:
    """Busca a lista de máquinas cadastradas no painel. None em caso de falha
    (mantém a última lista conhecida, para não perder leituras por um soluço de rede)."""
    try:
        response = await client.get(config_url, headers=headers)
        response.raise_for_status()
        data = response.json()
        return data.get("miners")
    except httpx.HTTPError as error:
        print(f"Falha ao buscar configuração da nuvem: {error}", flush=True)
        return None


async def run() -> None:
    config = load_config()
    headers = {"Authorization": f"Bearer {config['agent_token']}"}
    interval = max(10, int(config.get("poll_interval_seconds", 30)))
    config_url = config_url_from_api_url(config["api_url"])

    # Ponto de partida: config.json local, se alguém tiver preenchido manualmente.
    # Assim que a primeira busca na nuvem funcionar, ela vira a fonte de verdade.
    known_miners = config.get("miners", [])

    async with httpx.AsyncClient(timeout=15) as client:
        while True:
            remote_miners = await fetch_remote_miners(client, config_url, headers)
            if remote_miners is not None:
                known_miners = remote_miners

            metrics = await asyncio.gather(*(poll_miner(m) for m in known_miners))
            payload = {"observed_at": datetime.now(timezone.utc).isoformat(), "metrics": list(metrics)}
            try:
                response = await client.post(config["api_url"], headers=headers, json=payload)
                response.raise_for_status()
            except httpx.HTTPError as error:
                print(f"Falha ao enviar métricas: {error}", flush=True)
            await asyncio.sleep(interval)


if __name__ == "__main__":
    asyncio.run(run())
