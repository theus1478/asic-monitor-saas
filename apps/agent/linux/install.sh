#!/usr/bin/env bash
# Instala o coletor ASIC Monitor (versao Linux, sem janela) em /opt/asic-monitor-agent.
# Rode a partir da pasta extraida do pacote (onde este script esta).
set -euo pipefail

INSTALL_DIR="/opt/asic-monitor-agent"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 nao encontrado. Instale com o gerenciador de pacotes da sua distro (ex.: apt install python3 python3-venv)." >&2
  exit 1
fi

sudo mkdir -p "$INSTALL_DIR"
sudo cp "$SCRIPT_DIR/service.py" "$SCRIPT_DIR/miners.py" "$SCRIPT_DIR/requirements.txt" "$INSTALL_DIR/"
sudo cp -r "$SCRIPT_DIR/systemd" "$INSTALL_DIR/"

python3 -m venv "$INSTALL_DIR/venv"
"$INSTALL_DIR/venv/bin/pip" install --upgrade pip >/dev/null
"$INSTALL_DIR/venv/bin/pip" install -r "$INSTALL_DIR/requirements.txt"

echo ""
echo "Instalado em $INSTALL_DIR."
echo ""
echo "1) Rode uma vez pra configurar (URL e token vem em Fazendas -> Telemetria no painel):"
echo "   $INSTALL_DIR/venv/bin/python3 $INSTALL_DIR/service.py --api-url <URL_DA_API> --agent-token <TOKEN>"
echo ""
echo "2) Para o coletor iniciar sozinho a cada boot, habilite o servico systemd:"
echo "   sudo cp $INSTALL_DIR/systemd/asic-monitor-agent.service /etc/systemd/system/"
echo "   sudo systemctl daemon-reload"
echo "   sudo systemctl enable --now asic-monitor-agent"
echo ""
echo "3) Acompanhe os logs com:"
echo "   sudo journalctl -u asic-monitor-agent -f"
