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

from miners import apply_pool_config, poll_miner, reboot_miner

AGENT_VERSION = "0.5.1"

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


def _clean(value: str) -> str:
    """Remove aspas e espacos que sobram de um copia-e-cola."""
    return value.strip().strip('"').strip("'").strip()


def _ask_api_url() -> str:
    while True:
        raw = input("URL da API (ex: https://seu-dominio.vercel.app/api/agent/metrics): ")
        value = _clean(raw)
        if "--api-url" in value or "--agent-token" in value or value.endswith(".exe"):
            print("Isso parece o comando inteiro, nao so a URL. Cole apenas o endereco (comeca com https://).")
            continue
        if not value.startswith("http://") and not value.startswith("https://"):
            print("A URL precisa comecar com http:// ou https://. Tente novamente.")
            continue
        return value


def _ask_agent_token() -> str:
    while True:
        raw = input("Token do agente (gerado no painel, em Fazendas): ")
        value = _clean(raw)
        if "--" in value or " " in value:
            print("Isso nao parece um token valido (token nao tem espacos nem --). Cole apenas o token.")
            continue
        if not value:
            print("O token nao pode ficar vazio.")
            continue
        return value


def load_or_create_config(args: argparse.Namespace) -> dict:
    path = config_path()
    if path.exists():
        existing = json.loads(path.read_text(encoding="utf-8"))
        url = str(existing.get("api_url", ""))
        if url.startswith("http://") or url.startswith("https://"):
            return existing
        print(f"O config.json existente tem uma URL invalida ({url!r}). Vou pedir os dados de novo.")

    print("== Coletor ASIC Monitor Cloud ==")
    print("Primeira execucao: preciso da URL da API e do token do agente.")
    api_url = _clean(args.api_url) if args.api_url else _ask_api_url()
    agent_token = _clean(args.agent_token) if args.agent_token else _ask_agent_token()
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


def commands_url_from_api_url(api_url: str) -> str:
    if api_url.endswith("/metrics"):
        return api_url[: -len("/metrics")] + "/commands"
    return api_url.rstrip("/") + "/commands"


async def fetch_remote_miners(client: httpx.AsyncClient, config_url: str, headers: dict):
    try:
        response = await client.get(config_url, headers=headers)
        response.raise_for_status()
        return response.json().get("miners")
    except httpx.HTTPError as error:
        print(f"Falha ao buscar configuracao da nuvem: {error}", flush=True)
        return None


async def process_command(client: httpx.AsyncClient, commands_url: str, headers: dict):
    try:
        response = await client.get(commands_url, headers=headers)
        response.raise_for_status()
        command = response.json().get("command")
        if not command:
            return
        kind = command.get("kind")
        miners = command.get("miners", [])

        if kind == "pool_update":
            print(f"Aplicando troca de pool em {len(miners)} maquina(s)...", flush=True)
            results = await asyncio.gather(*(
                apply_pool_config(miner, miner.get("credentials"), command.get("pools", []))
                for miner in miners
            ))
            label = "Troca de pool"
        elif kind == "reboot":
            print(f"Reiniciando {len(miners)} maquina(s)...", flush=True)
            results = await asyncio.gather(*(reboot_miner(miner, miner.get("credentials")) for miner in miners))
            label = "Reinício"
        else:
            return

        report = await client.post(commands_url, headers=headers, json={"command_id": command["id"], "results": list(results)})
        report.raise_for_status()
        ok = sum(1 for item in results if item.get("success"))
        print(f"{label} finalizado: {ok}/{len(results)} com sucesso.", flush=True)
    except Exception as error:
        print(f"Falha ao processar comando: {error}", flush=True)


async def run(config: dict) -> None:
    headers = {"Authorization": f"Bearer {config['agent_token']}", "X-Agent-Version": AGENT_VERSION}
    interval = max(10, int(config.get("poll_interval_seconds", 30)))
    config_url = config_url_from_api_url(config["api_url"])
    commands_url = commands_url_from_api_url(config["api_url"])
    known_miners = config.get("miners", [])

    print(f"Coletor em execucao. Enviando para {config['api_url']} a cada {interval}s.")
    print("Deixe esta janela aberta (ou minimizada) para o coletor continuar rodando.")

    async with httpx.AsyncClient(timeout=15) as client:
        while True:
            remote_miners = await fetch_remote_miners(client, config_url, headers)
            if remote_miners is not None:
                known_miners = remote_miners

            await process_command(client, commands_url, headers)

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
