# Coletor local

Executável Windows único (`ASICMonitorAgent.exe`), com janela, sem instalador
separado e sem exigir Python na máquina do cliente. Ele não abre portas para a
internet: só conversa por HTTPS com a API Cloud. Além da telemetria, recebe
comandos de troca de pool e de reinício e os executa diretamente nas ASICs da
rede local.

Login próprio na primeira abertura (usuário/senha só desta máquina, em
`local_auth.json`) — protege o app de quem não deveria mexer nas configurações
de rede da fazenda. Depois do login, a janela principal deixa configurar a URL
da API e o token do agente (gerados no painel, em Fazendas → Gerar token do
agente), e cadastrar máquinas por IP manual ou escaneando a rede local (varre
`prefixo.1` a `prefixo.254` nas portas 4028/80). Cada máquina adicionada ou
removida na janela sincroniza na hora com o painel (`POST`/`DELETE
/api/agent/config`); o app também some com qualquer máquina cadastrada por lá,
então os dois lados ficam sempre iguais. Se registra na pasta *Inicializar* do
Windows (`shell:startup`) para abrir sozinho a cada login, sem precisar de
Tarefa Agendada nem de privilégio de administrador.

## Compilar o .exe

Distribuído como binário, mas o código-fonte é `gui_app.py` + `miners.py`
neste diretório (`service.py` continua existindo como uma versão de linha de
comando, sem janela, útil pra depurar sem abrir a interface). Para gerar (ou
regenerar) o executável:

```powershell
python -m pip install --user pyinstaller -r apps/agent/requirements.txt
cd apps/agent/src
python -m PyInstaller --onefile --windowed --name ASICMonitorAgent --clean gui_app.py
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

## Troca de pool

O painel cria um comando cifrado e o associa ao coletor da fazenda. A cada
ciclo, o agente consulta `GET /api/agent/commands`, aplica até três pools nas
máquinas escolhidas e envia o resultado por máquina ao mesmo endpoint. Há
suporte para Antminer com firmware Bitmain ou VNish, Avalon e Whatsminer API
v2/v3. Para usar esse recurso é necessário instalar a versão 0.3.0 ou posterior
do executável.
