# Coletor ASIC Monitor — Linux

Versão de linha de comando (sem janela) do mesmo coletor distribuído como
`.exe` no Windows — lê as ASICs da rede local e envia a telemetria pra nuvem,
recebe comandos de troca de pool, reinício e "parar mineração". O código é o
mesmo (`service.py` + `miners.py`); só a inicialização automática muda,
porque a pasta *Inicializar* do Windows não existe no Linux.

## Instalação rápida

```bash
tar xzf asic-monitor-agent-linux.tar.gz
cd asic-monitor-agent
./install.sh
```

O script instala em `/opt/asic-monitor-agent`, cria um ambiente virtual
Python e instala as dependências.

## Configurar e rodar

Pegue a URL da API e o token do agente no painel, em **Fazendas → Telemetria**
(gera uma credencial por fazenda). Rode uma vez manualmente para gravar
`config.json`:

```bash
/opt/asic-monitor-agent/venv/bin/python3 /opt/asic-monitor-agent/service.py \
  --api-url <URL_DA_API> --agent-token <TOKEN>
```

Depois disso o coletor já está rodando em primeiro plano. Pare com Ctrl+C
quando quiser configurar o serviço permanente.

## Iniciar sozinho a cada boot (systemd)

```bash
sudo cp /opt/asic-monitor-agent/systemd/asic-monitor-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now asic-monitor-agent
```

Acompanhar:

```bash
sudo journalctl -u asic-monitor-agent -f
```

Reconfigurar (trocar URL/token): edite ou apague
`/opt/asic-monitor-agent/config.json` e rode o passo de configuração de novo
antes de reiniciar o serviço.

## Requisitos

- Python 3.10+ e `python3-venv` (`sudo apt install python3 python3-venv` em
  distros baseadas em Debian/Ubuntu).
- Acesso de rede às ASICs (mesma sub-rede ou rota até a porta 4028/HTTP
  delas) e saída HTTPS para a API na nuvem.
