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


async def run() -> None:
    config = load_config()
    headers = {"Authorization": f"Bearer {config['agent_token']}"}
    interval = max(10, int(config.get("poll_interval_seconds", 30)))
    async with httpx.AsyncClient(timeout=15) as client:
        while True:
            miners = config.get("miners", [])
            metrics = await asyncio.gather(*(poll_miner(m) for m in miners))
            payload = {"observed_at": datetime.now(timezone.utc).isoformat(), "metrics": list(metrics)}
            try:
                response = await client.post(config["api_url"], headers=headers, json=payload)
                response.raise_for_status()
            except httpx.HTTPError as error:
                print(f"Falha ao enviar métricas: {error}", flush=True)
            await asyncio.sleep(interval)


if __name__ == "__main__":
    asyncio.run(run())
