# Configuração segura

Este documento registra **quais** credenciais o ASIC Monitor SaaS usa e onde configurá-las. Nunca registre valores reais de senhas, tokens, chaves privadas ou seed phrases no GitHub.

> **2026-09-18: saída da Vercel e do Supabase Cloud.** A aplicação e o banco
> agora rodam self-hosted numa VPS própria (ver "Infraestrutura self-hosted
> (VPS)" abaixo). O projeto `asicmonitor` no Supabase Cloud e o projeto
> `asic-monitor-saas-vercel` na Vercel foram **pausados** (não apagados) na
> mesma data — ver "Descomissionamento" ao final para como retomá-los.

## Supabase (self-hosted na VPS)

Configure em `apps/web/.env.local` para desenvolvimento e nas **variáveis de
ambiente do serviço `web` no EasyPanel** (`http://2.25.234.75:3000`, projeto
`asic-monitor`) para produção — não existe mais painel da Vercel para isso.

| Variável | Uso | Onde obter |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL pública do projeto | `https://db.monitorasic.club` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cliente web com RLS | Arquivo `/opt/supabase/docker/.env` na VPS (`ANON_KEY`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Operações administrativas do servidor | Mesmo arquivo (`SERVICE_ROLE_KEY`); só no ambiente do serviço `web`, nunca no navegador |

A pilha Supabase (11 containers: `supabase-db`, `supabase-auth`,
`supabase-rest`, `supabase-storage`, `supabase-studio`, `supabase-envoy`,
`supabase-meta`, `supabase-pooler`, `supabase-imgproxy`,
`supabase-edge-functions`, `realtime-dev.supabase-realtime`, Postgres 17.6)
roda via `docker compose` em `/opt/supabase/docker` na própria VPS, fora do
EasyPanel/Docker Swarm — só o `supabase-envoy` foi conectado à rede
`easypanel` (`docker network connect easypanel supabase-envoy`) para o
Traefik conseguir alcançá-lo e expor `db.monitorasic.club` com certificado
Let's Encrypt de verdade (roteador manual em
`/etc/easypanel/traefik/config/supabase.yaml` — não é gerenciado pela UI do
EasyPanel, que só entende serviços do próprio projeto).

O antigo projeto `asicmonitor` (Supabase Cloud, plano Free/`t3.nano`, que
sofria timeouts de conexão sob carga — motivo original da migração) fica
desligado do fluxo de produção; suas credenciais antigas não devem mais ser
usadas em nenhum ambiente.

As rotas `/dashboard`, `/farms`, `/billing` e `/admin` exigem uma sessão válida. O cadastro cria automaticamente um registro em `profiles` por meio da migration `0002_auth_profiles.sql`.

## Aplicação (self-hosted na VPS via EasyPanel)

Variáveis configuradas nas **variáveis de ambiente do serviço `web`** no
EasyPanel (API em `http://2.25.234.75:3000/api/updateAppEnv`, projeto
`asic-monitor`, serviço `web`) — mudanças em variáveis `NEXT_PUBLIC_*`
exigem um rebuild completo (`POST /api/deploy/<token>`) para valerem no
bundle do navegador, já que são embutidas em tempo de build; as demais
(server-only) só precisam de um restart (`POST /api/restartAppService`).

| Variável | Uso |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | URL canônica do painel: `https://monitorasic.club` |
| `AGENT_TOKEN_PEPPER` | Segredo usado para gerar hashes dos tokens dos agentes |
| `INVOICE_DERIVATION_SEED` | **Obrigatória para gerar faturas.** Semente mestra (segredo, só servidor) da qual `lib/solana-wallet.ts` deriva o endereço de depósito de cada fatura. Trocar o valor torna irrecuperável a chave de qualquer fatura pendente que já recebeu fundos — por isso nunca gere uma nova sem conferir on-chain que nenhuma fatura pendente tem saldo (foi recriada em 2026-09-18 depois de se perder na migração da Vercel). |
| `FEE_PAYER_SECRET_KEY` | **Obrigatória para a varredura.** Chave privada (base58) da carteira de baixo valor que só paga a taxa de rede da varredura para a tesouraria; precisa de um pouco de SOL (carteira atual: `3DfS4ACbCNo3Z5rTbm5u8tDpNnATsD6gUNyetaDp4h8s`). |
| `SOLANA_RPC_URL` | Endpoint RPC usado para conferir e varrer os pagamentos (padrão: RPC público da mainnet-beta) |
| `NEXT_PUBLIC_SOLANA_USDT_MINT` | Endereço do mint do USDT na rede Solana. Usado no QR code de pagamento (Solana Pay), por isso é público — não é segredo. |
| `NEXT_PUBLIC_BILLING_WALLET_PUBLIC_KEY` | Endereço público que recebe USDT. Público por natureza (é para onde o cliente paga), exposto no navegador para montar o QR code da fatura. |
| `RESEND_API_KEY` | Envio de e-mail transacional (alertas de ocorrência e o código de confirmação de 6 dígitos no cadastro/troca de e-mail) via Resend. Sem ela, ocorrências continuam sendo registradas normalmente (só o e-mail fica `skipped`), mas cadastro/verificação de e-mail não funcionam. |
| `ALERT_EMAIL_FROM` | Remetente usado nos e-mails acima. Opcional — sem ela, usa `ASIC Monitor <alerts@resend.dev>`. |
| `CRON_SECRET` | Protege as rotas `/api/cron/*` contra chamadas externas — exigido pelo `crontab` da própria VPS (ver "Tarefas agendadas" abaixo). Opcional no código, mas configurado em produção. |
| `HOSTNAME` | **Sempre `0.0.0.0`.** O servidor standalone do Next.js (`output: "standalone"`) escuta no endereço de `process.env.HOSTNAME`, e o Docker define essa variável automaticamente para o ID do container — que só resolve numa das redes do container. Sem essa sobrescrita, o Traefik nunca alcança a aplicação (erro 502) mesmo com o build/deploy "funcionando". |

Não existe mais "Development/Preview/Production" separados como na Vercel — hoje é um único ambiente (produção) na VPS; `apps/web/.env.local` continua servindo só para desenvolvimento local.

## Infraestrutura self-hosted (VPS)

| Item | Valor |
| --- | --- |
| Provedor / plano | Hostinger, KVM1 (2 vCPU anunciados, `lscpu` mostra 1 — a confirmar com o suporte) |
| IP | `2.25.234.75` |
| SO | Ubuntu 24.04 LTS |
| Acesso | SSH com chave (`~/.ssh/asic_monitor_vps`), usuário `root` |
| Painel | EasyPanel (`http://2.25.234.75:3000`), API bearer token próprio, Docker Swarm de nó único |
| Proxy/TLS | Traefik (gerenciado pelo EasyPanel), certificados Let's Encrypt automáticos |
| Domínios | `monitorasic.club` e `www.monitorasic.club` → app (`asic-monitor_web`, projeto `asic-monitor`); `db.monitorasic.club` → `supabase-envoy` |
| DNS | Dynadot (`ns1.dyna-ns.net`/`ns2.dyna-ns.net`) — painel do próprio domínio, TTL 5 min |
| Deploy do app | GitHub → EasyPanel (`source.type: "github"`, `owner: theus1478`, `repo: asic-monitor-saas`, `path: /apps/web`, `ref: main`), build via `apps/web/Dockerfile` (`build.type: "dockerfile"`, `file: "Dockerfile"`, relativo a `path`) |
| Auto-deploy | **Ainda não habilitado** — falta configurar um token do GitHub (`setGithubToken` na API do EasyPanel) com permissão `Contents: Read` + `Webhooks: Read and write` no repositório. Até lá, redeploy é manual: `GET /api/deploy/<token do serviço>`. |

### BitCart (testado e descontinuado em 2026-09-18)

Foi implantado um BitCart (USDT-BEP20) para substituir a cobrança em Solana e
depois **abandonado**: a carteira BNB dele usa **um único endereço** (mesmo
com carteira HD), então faturas de mesmo valor não se distinguem — não dá para
cobrar exatamente 1 USDT sem risco de misturar clientes. A cobrança voltou
para o fluxo Solana (endereço derivado por fatura). O stack continua
instalado, **parado**, em `/opt/bitcart-docker` (projeto Docker Compose
`bitcart`, containers `bitcart-*`; sobe de novo com `docker compose -p bitcart
--env-file .env -f compose/generated.yml -f compose/override-easypanel.yml up
-d`), com rotas Traefik em `/etc/easypanel/traefik/config/bitcart.yaml`
(`pay`/`pay-api.monitorasic.club`) e a coluna `invoices.bitcart_invoice_id`
(migration 0021, sem uso). Pode ser removido com `docker compose -p bitcart
down -v` quando não for mais necessário.

### Tarefas agendadas (substituem o Vercel Cron)

A Vercel executava os crons definidos em `apps/web/vercel.json`. Na VPS isso
virou `crontab` do usuário `root`, chamando as mesmas rotas com
`Authorization: Bearer $CRON_SECRET`:

```
0 6 * * * curl -sS -m 30 -H "Authorization: Bearer <CRON_SECRET>" https://monitorasic.club/api/cron/affiliate-commissions >> /var/log/asic-monitor-cron.log 2>&1
0 7 * * * curl -sS -m 30 -H "Authorization: Bearer <CRON_SECRET>" https://monitorasic.club/api/cron/asic-health-sweep >> /var/log/asic-monitor-cron.log 2>&1
```

### Descomissionamento (Vercel e Supabase Cloud pausados em 2026-09-18)

Antes de desligar, foi conferido no banco antigo que nada mais enviava
telemetria para lá (0 leituras nos 5 minutos anteriores). Um coletor
(Farm Favela 00) ainda estava com a URL antiga e só foi migrado depois de
apontado para `https://monitorasic.club/api/agent/metrics` — **um coletor com
`api_url` antiga fica sem monitoramento em silêncio**, sem erro visível no
painel novo.

- **Supabase Cloud (`asicmonitor`, ref `dsycgqvtvaxhfjxmsatw`):** projeto
  **pausado** (Settings → General → Pause project). Os dados ficam guardados;
  pode ser retomado por até 1 ano (depois só restam os backups para download).
  Contém o histórico de telemetria da Farm Favela entre 03:26 e ~20:40 UTC de
  2026-09-18 e qualquer cadastro/licença criado só lá depois do dump inicial
  (o resync final foi dispensado) — se precisar, retome o projeto e copie o
  que faltar. A organização tem um segundo projeto (`theus1478's Project`)
  que não faz parte deste app e não foi tocado.
- **Vercel (`asic-monitor-saas-vercel`):** projeto **pausado** (Settings →
  General → Pause Project): a URL `*.vercel.app` responde 503
  `DEPLOYMENT_PAUSED`; retoma sem redeploy. Ainda liga o repositório
  `theus1478/asic-monitor-saas` e continua gerando *preview deployments* a cada
  push (apontam para o Supabase pausado, então não funcionam) — desconectar o
  Git é opcional. O outro projeto (`asic-monitor`, sem Git) já não tinha
  deploy servindo (404).
- Só depois de um período de operação estável na VPS faz sentido **apagar**
  os dois projetos (irreversível).

### Acesso remoto às máquinas (relay + certificado curinga)

- **Serviço `relay`** (EasyPanel, projeto `asic-monitor`; GitHub
  `theus1478/asic-monitor-saas`, caminho `/apps/relay`, Dockerfile). Variáveis:
  `SUPABASE_URL` (`https://db.monitorasic.club`), `SUPABASE_SERVICE_ROLE_KEY`,
  `AGENT_TOKEN_PEPPER` (o mesmo do `web`), `REMOTE_ACCESS_SECRET`,
  `REMOTE_BASE_DOMAIN=remote.monitorasic.club`, `PORT=8080`. Domínio
  `relay.monitorasic.club` (Let's Encrypt comum) → porta 8080; é o endereço
  `wss://relay.monitorasic.club/agent` que o coletor usa. `GET /__health` → `ok`.
- **Serviço `web`**: `REMOTE_ACCESS_SECRET` (**igual** ao do relay),
  `REMOTE_BASE_DOMAIN`, `REMOTE_RELAY_URL` (padrão
  `wss://relay.monitorasic.club/agent`). Sem `REMOTE_ACCESS_SECRET` o botão
  "Acessar máquina" responde erro de configuração.
- **DNS (Dynadot)**: `relay` A e `*.remote` A → `2.25.234.75`. O DNS foi alterado
  pela API (`set_dns2` reenviando **todos** os registros existentes — esse
  comando substitui o conjunto inteiro; backup do estado anterior em
  `/root/secrets/dns-backup.json` na VPS).
- **Certificado curinga** `*.remote.monitorasic.club` (só sai por DNS-01):
  emitido com `goacme/lego` (provedor `dynadot`, container avulso, dados em
  `/root/lego`; a espera de propagação precisa ser fixa,
  `--dns.propagation.wait 240s`, porque a checagem ativa passa antes de todos os
  servidores da Dynadot terem o TXT e a validação secundária do Let's Encrypt
  falha). Arquivos em `/etc/easypanel/traefik/certs/remote.{crt,key}`; rota em
  `/etc/easypanel/traefik/config/remote.yaml` (`tls.certificates` + roteador
  `HostRegexp(^m-<uuid>\.remote\.monitorasic\.club$)` → `http://asic-monitor_relay:8080`).
  A chave da API Dynadot fica **só** em `/root/secrets/dynadot.env` (modo 600,
  `DYNADOT_API_KEY`/`DYNADOT_API_SECRET`); se as chaves forem regeneradas,
  atualize esse arquivo.
- **Renovação**: `/root/renew-remote-cert.sh` (cron semanal, segunda 04:17;
  log em `/var/log/renew-remote-cert.log`). O `lego run` só renova quando falta
  pouco para vencer; ao trocar o certificado o script recopia os arquivos e
  reescreve `remote.yaml` para o Traefik recarregar. O certificado atual vence em
  2026-12-17.
- **Migration `0022_remote_access.sql`** deve ser aplicada **antes** de subir o
  código que a usa (`/api/agent/config` passou a ler `farms.remote_access_enabled`
  e `miners.web_port`).

## Agente local da fazenda

Cada cliente receberá um arquivo `config.json` baseado em `apps/agent/config.example.json`.

| Campo | Uso |
| --- | --- |
| `api_url` | Endpoint HTTPS da aplicação — `https://monitorasic.club/api/agent/metrics` (domínio próprio, não muda mesmo com a troca de hospedagem) |
| `agent_token` | Token exclusivo e revogável de uma fazenda |
| `poll_interval_seconds` | Intervalo de leitura dos ASICs |
| `miners` | Endereços IP locais autorizados para monitoramento |

O agente nunca armazena credenciais Supabase, chave de carteira ou senha do administrador. Como o `api_url` de cada cliente já usa o domínio próprio (`monitorasic.club`), a troca de hospedagem foi transparente para agentes já instalados — nenhuma reconfiguração foi necessária.

## GitHub

O repositório é `theus1478/asic-monitor-saas`. Para automações, use token fine-grained limitado a esse repositório. Para deploy manual/CI, `Contents: Read and write` basta; para habilitar o auto-deploy do EasyPanel (webhook), inclua também `Webhooks: Read and write`. Defina uma expiração curta e revogue-o quando a configuração terminar.

## Senhas e recuperação

- Guarde senhas de banco, carteiras e contas em um gerenciador de senhas.
- A senha do banco Postgres não deve entrar em `.env`, no código ou no GitHub.
- A seed phrase da carteira Solana nunca deve ser usada pela aplicação. A cobrança utiliza somente a chave pública.
