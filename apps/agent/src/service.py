"""Coletor ASIC Monitor Cloud - ponto de entrada do executavel distribuido.

Na primeira execucao pede a URL da API e o token do agente (ou aceita via
--api-url/--agent-token), grava config.json ao lado do executavel e se
registra na pasta Inicializar do Windows para rodar sozinho a cada login.
Nas execucoes seguintes, le o config.json e roda o loop de coleta direto.

Empacotado com PyInstaller (veja README.md) para virar um .exe unico —
sem precisar de Python instalado na maquina do cliente.
"""
import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx

from miners import poll_miner

STARTUP_DIR = Path(os.environ.get("APPDATA", "")) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"
STARTUP_LAUNCHER_NAME = "ASICMonitorAgent.bat"


def base_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def config_path() -> Path:
    return base_dir() / "config.json"


def ensure_startup_entry() -> None:
    """Cria um atalho .bat na pasta Inicializar para rodar minimizado a cada login."""
    try:
        STARTUP_DIR.mkdir(parents=True, exist_ok=True)
        launcher = STARTUP_DIR / STARTUP_LAUNCHER_NAME
        exe_path = Path(sys.executable).resolve() if getattr(sys, "frozen", False) else Path(__file__).resolve()
        content = f'@echo off\r\nstart "" /min "{exe_path}"\r\n'
        launcher.write_text(content, encoding="utf-8")
        print(f"Inicializacao automatica registrada: {launcher}")
    except OSError as error:
        print(f"Aviso: nao consegui registrar a inicializacao automatica: {error}")


def create_config(api_url: str, agent_token: str, poll_interval_seconds: int) -> dict:
    config = {
        "api_url": api_url,
        "agent_token": agent_token,
        "poll_interval_seconds": poll_interval_seconds,
        "miners": [],
    }
    config_path().write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8")
    return config


def load_or_create_config(args: argparse.Namespace) -> dict:
    path = config_path()
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))

    print("== Coletor ASIC Monitor Cloud ==")
    print("Primeira execucao: preciso da URL da API e do token do agente.")
    api_url = args.api_url or input("URL da API (ex: https://seu-dominio.vercel.app/api/agent/metrics): ").strip()
    agent_token = args.agent_token or input("Token do agente (gerado no painel, em Fazendas): ").strip()
    if not api_url or not agent_token:
        print("URL da API e token do agente sao obrigatorios.")
        sys.exit(1)

    config = create_config(api_url, agent_token, args.poll_interval or 30)
    print(f"Configuracao salva em: {path}")
    ensure_startup_entry()
    return config


def config_url_from_api_url(api_url: str) -> str:
    if api_url.endswith("/metrics"):
        return api_url[: -len("/metrics")] + "/config"
    return api_url.rstrip("/") + "/config"


async def fetch_remote_miners(client: httpx.AsyncClient, config_url: str, headers: dict):
    try:
        response = await client.get(config_url, headers=headers)
        response.raise_for_status()
        return response.json().get("miners")
    except httpx.HTTPError as error:
        print(f"Falha ao buscar configuracao da nuvem: {error}", flush=True)
        return None


async def run(config: dict) -> None:
    headers = {"Authorization": f"Bearer {config['agent_token']}"}
    interval = max(10, int(config.get("poll_interval_seconds", 30)))
    config_url = config_url_from_api_url(config["api_url"])
    known_miners = config.get("miners", [])

    print(f"Coletor em execucao. Enviando para {config['api_url']} a cada {interval}s.")
    print("Deixe esta janela aberta (ou minimizada) para o coletor continuar rodando.")

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
                print(f"[{datetime.now().strftime('%H:%M:%S')}] {len(known_miners)} maquina(s) reportadas.", flush=True)
            except httpx.HTTPError as error:
                print(f"Falha ao enviar metricas: {error}", flush=True)
            await asyncio.sleep(interval)


def main() -> None:
    parser = argparse.ArgumentParser(description="Coletor ASIC Monitor Cloud")
    parser.add_argument("--api-url", dest="api_url", default=None)
    parser.add_argument("--agent-token", dest="agent_token", default=None)
    parser.add_argument("--poll-interval", dest="poll_interval", type=int, default=None)
    args = parser.parse_args()

    config = load_or_create_config(args)

    try:
        asyncio.run(run(config))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
