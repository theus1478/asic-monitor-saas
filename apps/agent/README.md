# Coletor local

Executável Windows único (`ASICMonitorAgent.exe`), sem instalador separado e
sem exigir Python na máquina do cliente. Ele não abre portas para a internet:
só envia métricas por HTTPS para a API Cloud.

Na primeira execução, pede a URL da API e o token do agente (gerado no painel,
em Fazendas → Gerar token do agente) — ou aceita via `--api-url`/`--agent-token`.
Grava `config.json` ao lado do executável e se registra na pasta *Inicializar*
do Windows (`shell:startup`) para rodar sozinho a cada login, sem precisar de
Tarefa Agendada nem de privilégio de administrador.

## Compilar o .exe

Distribuído como binário, mas o código-fonte é `service.py` + `miners.py` neste
diretório. Para gerar (ou regenerar) o executável:

```powershell
python -m pip install --user pyinstaller httpx
cd apps/agent/src
python -m PyInstaller --onefile --console --name ASICMonitorAgent --clean service.py
```

O resultado fica em `dist/ASICMonitorAgent.exe` — copie para
`apps/web/public/downloads/ASICMonitorAgent.exe` para publicar no site.

Por não ser assinado digitalmente, o Windows SmartScreen mostra um aviso
("Editor desconhecido") na primeira execução; o usuário precisa clicar em
"Mais informações" → "Executar assim mesmo".

## Fonte da lista de máquinas

O `config.json` local não precisa listar as ASICs manualmente. A cada ciclo, o
coletor busca em `GET /api/agent/config` (mesmo token do agente) a lista de
máquinas cadastradas naquela fazenda no painel — nome, IP, porta e fabricante
(`antminer`, `whatsminer` ou `avalon`). O campo `miners` do arquivo local só
serve como fallback caso a busca na nuvem falhe temporariamente.
