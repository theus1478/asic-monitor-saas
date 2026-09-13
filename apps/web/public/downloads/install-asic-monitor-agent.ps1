#Requires -Version 5.1
<#
  Instalador do coletor ASIC Monitor Cloud.
  Uso:
    .\install-asic-monitor-agent.ps1 -ApiUrl "https://seu-dominio.vercel.app/api/agent/metrics" -AgentToken "SEU_TOKEN"

  O coletor roda em segundo plano (Agendador de Tarefas do Windows, sem janela
  visível), lê as ASICs configuradas na rede local e envia métricas por HTTPS.
  Nenhuma porta da sua rede é aberta para a internet.
#>
param(
  [Parameter(Mandatory = $false)][string]$ApiUrl,
  [Parameter(Mandatory = $false)][string]$AgentToken,
  [int]$PollIntervalSeconds = 30
)

$ErrorActionPreference = "Stop"
$installDir = Join-Path $env:ProgramData "ASICMonitorAgent"
$taskName = "ASICMonitorAgent"

Write-Host "== Instalador do coletor ASIC Monitor Cloud ==" -ForegroundColor Cyan

if (-not $ApiUrl) {
  $ApiUrl = Read-Host "URL da API (ex: https://seu-dominio.vercel.app/api/agent/metrics)"
}
if (-not $AgentToken) {
  $AgentToken = Read-Host "Token do agente (gerado no painel, em Fazendas)"
}
if (-not $ApiUrl -or -not $AgentToken) {
  Write-Error "URL da API e token do agente são obrigatórios."
  exit 1
}

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
  Write-Error "Python 3 não encontrado no PATH. Instale em https://www.python.org/downloads/ (marque 'Add to PATH') e rode este script novamente."
  exit 1
}

New-Item -ItemType Directory -Path $installDir -Force | Out-Null
Write-Host "Instalando em $installDir"

@'
"""Coletor sem interface para execucao na rede local da fazenda."""
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
    """Consulta a API local do minerador; falhas viram metrica offline."""
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
                print(f"Falha ao enviar metricas: {error}", flush=True)
            await asyncio.sleep(interval)


if __name__ == "__main__":
    asyncio.run(run())
'@ | Set-Content -Path (Join-Path $installDir "service.py") -Encoding utf8

@'
httpx>=0.27,<1
'@ | Set-Content -Path (Join-Path $installDir "requirements.txt") -Encoding utf8

$existingMiners = @()
$configPath = Join-Path $installDir "config.json"
if (Test-Path $configPath) {
  try { $existingMiners = (Get-Content $configPath -Raw | ConvertFrom-Json).miners } catch {}
}

$config = [ordered]@{
  api_url               = $ApiUrl
  agent_token            = $AgentToken
  poll_interval_seconds  = $PollIntervalSeconds
  miners                 = if ($existingMiners) { $existingMiners } else { @() }
}
$config | ConvertTo-Json -Depth 5 | Set-Content -Path $configPath -Encoding utf8

Write-Host "Instalando dependencias Python (httpx)..."
& python -m pip install --quiet --target (Join-Path $installDir "libs") -r (Join-Path $installDir "requirements.txt")

$pythonw = Get-Command pythonw -ErrorAction SilentlyContinue
$exe = if ($pythonw) { $pythonw.Source } else { $python.Source }
$serviceArgs = "`"$(Join-Path $installDir 'service.py')`""

$action = New-ScheduledTaskAction -Execute $exe -Argument $serviceArgs -WorkingDirectory $installDir
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -Hidden

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
  -Description "Coletor ASIC Monitor Cloud - envia metricas das ASICs da rede local para a nuvem." | Out-Null

$env:ASIC_MONITOR_CONFIG = $configPath
Start-ScheduledTask -TaskName $taskName

Write-Host ""
Write-Host "Instalado com sucesso." -ForegroundColor Green
Write-Host "O coletor inicia automaticamente a cada login do Windows e ja foi iniciado agora."
Write-Host "Configuracao: $configPath"
Write-Host "Para monitorar ASICs, edite o campo 'miners' desse arquivo (nome, IP e porta) e reinicie a tarefa:"
Write-Host "  Stop-ScheduledTask -TaskName $taskName; Start-ScheduledTask -TaskName $taskName"
