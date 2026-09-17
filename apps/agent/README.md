# Coletor local

Executável Windows único (`ASICMonitorAgent.exe`), com janela, sem instalador
separado e sem exigir Python na máquina do cliente. Ele não abre portas para a
internet: só conversa por HTTPS com a API Cloud. Além da telemetria, recebe
comandos de troca de pool e de reinício e os executa diretamente nas ASICs da
rede local.

Pede a URL da API e o token do agente (gerados no painel, em Fazendas →
Gerar token do agente) na primeira vez que abre — valida contra a nuvem antes
de entrar e mostra o nome da fazenda e quantas licenças estão em uso. Da
segunda vez em diante, entra sozinho: os últimos valores ficam salvos em
`last_login.json` e o app tenta esse login automaticamente assim que abre,
sem exigir clique nenhum. Se a validação falhar (token revogado, rede fora),
cai de volta na tela de login para uma tentativa manual. Depois de entrar,
cadastra máquinas por IP manual (com confirmação explícita — botão OK, que só
aceita depois de validar o formato do IP) ou escaneando uma faixa de IP (você
escolhe início e fim; confirma o protocolo real de cada dispositivo, não só a
porta aberta). Cada máquina adicionada ou removida sincroniza na hora com o
painel (`POST`/`DELETE /api/agent/config`); o app também some com qualquer
máquina cadastrada por lá, então os dois lados ficam sempre iguais.

Se registra na pasta *Inicializar* do Windows (`shell:startup`) para abrir
sozinho, minimizado, a cada login do Windows — combinado com o login
automático acima, isso significa que o monitoramento volta a rodar sem
ninguém precisar tocar no PC depois de um reinício. Não precisa de Tarefa
Agendada nem de privilégio de administrador. Exige a versão 0.7.0 ou
posterior do executável.

## Compilar o .exe

Distribuído como binário, mas o código-fonte é `gui_app.py` + `miners.py`
neste diretório (`service.py` continua existindo como uma versão de linha de
comando, sem janela, útil pra depurar sem abrir a interface). Para gerar (ou
regenerar) o executável:

```powershell
python -m pip install --user pyinstaller -r apps/agent/requirements.txt
cd apps/agent/src
python -m PyInstaller --onefile --windowed --noupx --name ASICMonitorAgent --clean gui_app.py
```

O resultado fica em `dist/ASICMonitorAgent.exe` — copie para
`apps/web/public/downloads/ASICMonitorAgent.exe` para publicar no site.

`--noupx` não é opcional: com a compressão UPX padrão do PyInstaller, o
Windows Defender marca o executável como `Trojan:Win32/Wacatac.B!ml` (falso
positivo do classificador de ML dele, reage ao padrão de compressão, não ao
conteúdo) — confirmado testando localmente com `Start-MpScan`. Sem UPX, o
arquivo fica ~1MB maior mas passa limpo.

Por não ser assinado digitalmente, o Windows SmartScreen ainda pode mostrar
um aviso ("Editor desconhecido") na primeira execução; o usuário precisa
clicar em "Mais informações" → "Executar assim mesmo". Isso é diferente do
Defender marcar como vírus — é só o SmartScreen dizendo que não conhece o
publicador.

## Fonte da lista de máquinas

O `config.json` local não precisa listar as ASICs manualmente. A cada ciclo, o
coletor busca em `GET /api/agent/config` (mesmo token do agente) a lista de
máquinas cadastradas naquela fazenda no painel — nome, IP, porta e fabricante
(`antminer`, `whatsminer` ou `avalon`). O campo `miners` do arquivo local só
serve como fallback caso a busca na nuvem falhe temporariamente.

## Whatsminer: BixBit vs. firmware original (BTMiner)

`parse_whatsminer` foi escrita originalmente contra firmware BixBit, que
expõe campos próprios não documentados em nenhum outro lugar (`PSU
Vin0/Iin0/Vout/Iout` para tensão/corrente real, `Power`/`Power Rate` para
consumo/eficiência, `Miner Type` para o modelo). O firmware original da
Whatsminer (BTMiner) nem sempre expõe esses mesmos campos pelo socket cgminer
de leitura (porta 4028) — o canal cifrado de escrita (portas 4028/4433, ver
`_set_whatsminer_v2`/`_set_whatsminer_v3`) é uma API completamente separada,
só usada pra trocar pool.

Pra cobrir os dois sem regredir o que já funciona (BixBit continua tentado
primeiro, campo por campo), o parser cai em fallbacks quando os campos
nomeados do BixBit vêm vazios:

- **Modelo**: se `Miner Type`/`Model` não vier no `summary`, tenta o comando
  clássico `version` (`VERSION[0].Type`) e depois o comando documentado
  `get_version` (`Msg.miner_type`, ver abaixo).
- **Temperatura/fan por placa**: se `Chip Temp Max`/`Temperature`/`Fan Speed
  In`/`Fan Speed Out` não vierem, casa por padrão genérico (`temp1`,
  `temp2_1`, `fan1`...) nos dados de `devs`/`edevs`, mesma estratégia já
  usada pro Antminer sem VNish.
- **Consumo**: sem `Power`/PSU medidos nem `get_psu`, estima por eficiência
  W/TH do modelo (mesma tabela `EFFICIENCY_WTH` que já cobre
  M30/M31/M32/M50/M60), com `power_estimated: true` deixando claro que não é
  leitura real.

### Comandos documentados (`edevs`/`get_version`/`get_psu`) vs. nomes cgminer classicos

O manual oficial da API BTMiner (MicroBT, porta 4028 — mesmo socket que o
BixBit usa) documenta um jogo de comandos ligeiramente diferente do
protocolo cgminer clássico que o resto do coletor usa (`devs`, `version`).
Pra placa/temperatura por hashboard o nome certo é **`edevs`** (não `devs`);
pro modelo é **`get_version`** (campo `miner_type`, não `version`); e pra
tensão/corrente/potência reais da fonte existe um comando dedicado,
**`get_psu`** (`vin` em unidades de 10 mV, `iin` em mA, `pin` já em W) — o
`summary` sozinho nem sempre traz `Power`/PSU no firmware original, mesmo
que o manual mostre esses campos no exemplo.

`poll_miner` tenta os dois jogos de comando em paralelo (`devs`+`version`
clássicos e `edevs`+`get_version`+`get_psu` documentados) e `parse_whatsminer`
prioriza os documentados quando presentes, sem quebrar o BixBit (que
responde aos nomes clássicos com campos próprios que os documentados não
têm, como `PSU Vin0`/`Chip Temp Max` por placa).

### Whatsminer sem API nenhuma no socket 4028: painel LuCI por HTTP

Confirmado contra uma máquina real: algumas versões do firmware original
(BTMiner) **desativam por padrão** a API do socket 4028 — a conexão TCP abre,
mas fecha sem responder a nenhum comando (`{"command":"summary"}` inclusive).
Nessas máquinas o único jeito de monitorar é a própria página HTML do painel
local, que é um **LuCI** (framework do OpenWrt) em
`/cgi-bin/luci/admin/status/btminerstatus`.

`parse_whatsminer_luci` (em `miners.py`) faz login (tenta `admin`/`admin` e
`root`/`root`, mesmo padrão já usado no resto do projeto), busca essa página
e extrai hashrate, temperatura por placa, consumo real e pool a partir dos
campos ocultos do formulário (`<input type="hidden" id="cbid.table.N.campo"
value="...">`). `poll_miner` tenta o socket 4028 primeiro (`summary` +
`edevs`/`get_version`/`get_psu`, ver seção acima) e só cai pro LuCI se faltar
hashrate, temperatura, consumo real ou pool depois disso — nesse caso os
dois resultados são combinados, preenchendo só o que faltou.

O escaneamento de rede (`gui_app.py`, `_probe_whatsminer_luci`) faz o mesmo
login de verdade (não só olha o texto da página sem sessão — o LuCI
redireciona pra tela de login em qualquer roteador OpenWrt, então checar só
esse texto sem autenticar dava falso negativo) e confirma pela página de
status autenticada, então essas máquinas aparecem certas desde o cadastro
automático, sem precisar adicionar manualmente e marcar o fabricante à mão.

Esse layout HTML não é uma API documentada — pode variar entre versões de
firmware. Se um campo vier errado ou a máquina não for detectada, mandar a
mesma página (Ctrl+U no navegador, na tela "Miner Status" do painel local) é
o jeito mais rápido de ajustar.

## Troca de pool

O painel cria um comando cifrado e o associa ao coletor da fazenda. A cada
ciclo, o agente consulta `GET /api/agent/commands`, aplica até três pools nas
máquinas escolhidas e envia o resultado por máquina ao mesmo endpoint. Há
suporte para Antminer com firmware Bitmain ou VNish, Avalon e Whatsminer API
v2/v3 — exige a senha real de acesso da máquina (o painel manda `admin`/`admin`
ou `root`/`root` por padrão; se a ASIC tiver senha própria, tem que trocar pra
credenciais personalizadas na hora de criar o comando, senão ela recusa com
"no permission for write command"). Para usar esse recurso é necessário
instalar a versão 0.3.0 ou posterior do executável.

## Reiniciar máquina

Mesma fila de comandos da troca de pool (`kind: "reboot"`), um clique na
página da máquina no painel. Cada fabricante usa um caminho diferente:

- **Antminer (VNish)**: autentica em `/api/v1/unlock` com a senha (mesmo fluxo
  da troca de pool) e reinicia com o token recebido. Sem senha configurada,
  tenta sem autenticação — funciona em firmware Bitmain padrão sem VNish.
- **Avalon**: comando `restart` puro no socket cgminer (porta 4028), sem
  autenticação.
- **Whatsminer**: comando `reboot` puro no socket cgminer (porta 4028), sem
  autenticação — BTMiner trata reboot como ação de baixo risco, diferente de
  trocar pool (que mexe na carteira de pagamento e por isso exige o canal
  cifrado com senha). Mesmo caminho que ferramentas como o WhatsminerTool
  usam.

Reboot costuma derrubar a conexão no meio do envio; uma queda logo após
mandar o comando é tratada como sucesso provável, não como falha. Exige a
versão 0.5.1 ou posterior do executável.

## Detecção de fabricante no escaneamento

Avalon e Antminer com firmware original (bmminer — sem VNish instalado, o que
inclui placas controladoras AML, Xil e BB) falam o mesmo protocolo de socket
cgminer na porta 4028 que o Whatsminer usa, então a porta aberta sozinha não
diz o fabricante. O escaneamento por faixa de IP confirma isso enviando um
comando extra (`estats`/`summary`) e olhando campos característicos de cada
firmware (`MM ID*` do Avalon, `Miner Type` do BixBit/Whatsminer); sem nenhum
dos dois, assume Antminer com firmware original. Exige a versão 0.6.0 ou
posterior do executável.

A telemetria de Antminer sem VNish (mesmas placas AML, Xil e BB) usa o mesmo
fallback: se a API HTTP do VNish (`/api/v1/summary`) não responder, o coletor
cai pro socket cgminer padrão e lê temperatura/fan pelos nomes de campo
genéricos do bmminer (`temp*`, `fan*`), sem tensão/corrente (Bitmain não
expõe esse dado em nenhum dos dois firmwares) e com potência estimada por
eficiência W/TH, igual ao caminho VNish quando o consumo real vem zerado.

## Tensão e corrente

Só Avalon reporta tensão/corrente real (leitura `PS[]` do próprio firmware).
Antminer (Bitmain/VNish) não expõe esse dado em nenhum endpoint — o coletor
já chegou a inferir um valor sintético (230V nominal, corrente = potência /
230V), mas isso não é telemetria real, e foi removido. Cards e histórico de
Antminer não mostram tensão/corrente; só potência (`power_consumption`), que
essa sim vem direto do firmware.
