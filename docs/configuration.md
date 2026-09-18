# Configuração segura

Este documento registra **quais** credenciais o ASIC Monitor SaaS usa e onde configurá-las. Nunca registre valores reais de senhas, tokens, chaves privadas ou seed phrases no GitHub.

> **2026-09-18: saída da Vercel e do Supabase Cloud.** A aplicação e o banco
> agora rodam self-hosted numa VPS própria (ver "Infraestrutura self-hosted
> (VPS)" abaixo). Vercel e o projeto `asicmonitor` no Supabase Cloud
> continuam existindo, mas **não recebem mais tráfego** desde que o DNS de
> `monitorasic.club` passou a apontar para a VPS — ficam só como rede de
> segurança até a operação nova se provar estável, e devem ser
> desligados/despromovidos depois disso (ver "Descomissionamento" ao final).

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
| `BITCART_API_URL` | API do BitCart usada pelo app. Em produção o endereço **interno** `http://bitcart-backend-1:8000` (mesma rede Docker `easypanel`); o público é `https://pay-api.monitorasic.club`. |
| `BITCART_API_TOKEN` | Token do BitCart com permissão só de `invoice_management` (criar/ler invoices). Segredo. |
| `BITCART_STORE_ID` | Id da loja "ASIC Monitor" no BitCart. |
| `BITCART_WEBHOOK_SECRET` | Segredo (32 bytes hex) que vai na query da `notification_url` e é exigido por `POST /api/webhooks/bitcart`. Sem ele o webhook responde 401. |
| `BITCART_WEBHOOK_BASE_URL` | Base usada na `notification_url` das invoices. Em produção `http://asic-monitor_web:3000` (o BitCart chama o app pela rede interna, sem depender do DNS público/hairpin da VPS); se ausente cai em `NEXT_PUBLIC_APP_URL`. |
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

### BitCart (pagamentos USDT-BEP20)

Stack oficial `bitcart/bitcart-docker` em `/opt/bitcart-docker` na VPS, **sem
usar o `setup.sh`** (ele reinicia o Docker, registra serviço systemd e monta o
`authorized_keys` do host no container — risco de tomada do servidor). O
compose foi gerado à mão com `./build.sh` e subido com o projeto `bitcart`:

```
export NAME=bitcart BITCART_INSTALL=backend BITCART_ADDITIONAL_COMPONENTS=admin \
  BITCART_CRYPTOS=bnb BITCART_REVERSEPROXY=none \
  BITCART_HOST=pay-api.monitorasic.club BITCART_ADMIN_HOST=pay.monitorasic.club \
  BITCART_ADMIN_API_URL=https://pay-api.monitorasic.club BITCART_HTTPS_ENABLED=true \
  BITCART_BACKEND_PORT=127.0.0.1:8100 BITCART_ADMIN_PORT=127.0.0.1:4100
./build.sh
docker compose -p bitcart --env-file .env -f compose/generated.yml -f compose/override-easypanel.yml up -d
```

| Item | Valor |
| --- | --- |
| Containers | `bitcart-backend-1`, `bitcart-worker-1`, `bitcart-admin-1`, `bitcart-database-1` (Postgres próprio), `bitcart-redis-1`, `bitcart-binancecoin-1` (daemon BNB via RPC público — não sincroniza nó) |
| Portas no host | só loopback (`127.0.0.1:8100` API, `127.0.0.1:4100` painel); nada exposto publicamente |
| Rede/TLS | `compose/override-easypanel.yml` anexa `backend` e `admin` à rede `easypanel` e define `mem_limit`; rotas Traefik manuais em `/etc/easypanel/traefik/config/bitcart.yaml` (`pay.monitorasic.club` → painel, `pay-api.monitorasic.club` → API), certificados Let's Encrypt |
| DNS (Dynadot) | `pay` e `pay-api` → `2.25.234.75` |
| Carteira | wallet watch-only `USDT-BEP20` (moeda `bnb`, contrato `0x55d398326f99059fF775485246999027B3197955`) sobre o endereço público BSC do dono — sem chave privada na VPS |
| Credenciais | `/opt/bitcart-docker/app-credentials.env` (chmod 600, só na VPS): login do painel (`billing-admin@monitorasic.club`), id da loja/wallet e token do app |
| Swap | 2 GB (`/swapfile`, em `/etc/fstab`) — a VPS tem só 3,8 GB de RAM |

Pontos de atenção:

- **Faturas simultâneas:** como a carteira é um único endereço, o BitCart não
  distingue invoices de mesmo valor (testado: 3 invoices de US$ 1 saíram com o
  mesmo endereço e valor — também com uma carteira HD, que o BNB do BitCart
  não deriva por fatura; essa carteira de teste foi apagada com saldo zero).
  O app cobra o valor exato e só adiciona poeira se houver conflito — ver
  "Pagamentos via BitCart" em `docs/architecture.md`.
- **Recriar containers** (`docker compose up --force-recreate`) mantém a rede
  `easypanel` porque ela está no override; sem o `-f compose/override-easypanel.yml`
  a rota Traefik deixa de alcançar o BitCart.
- O painel `pay.monitorasic.club` é público (tela de login). Use senha forte e
  considere restringir por IP se não for usado no dia a dia — a API pode ser
  operada só pelo app.
- Segredos rotacionados em 2026-09-18 para 32 bytes: `CRON_SECRET` e
  `BITCART_WEBHOOK_SECRET` (as versões anteriores tinham só 16 caracteres).

### Tarefas agendadas (substituem o Vercel Cron)

A Vercel executava os crons definidos em `apps/web/vercel.json`. Na VPS isso
virou `crontab` do usuário `root`, chamando as mesmas rotas com
`Authorization: Bearer $CRON_SECRET`:

```
0 6 * * * curl -sS -m 30 -H "Authorization: Bearer <CRON_SECRET>" https://monitorasic.club/api/cron/affiliate-commissions >> /var/log/asic-monitor-cron.log 2>&1
0 7 * * * curl -sS -m 30 -H "Authorization: Bearer <CRON_SECRET>" https://monitorasic.club/api/cron/asic-health-sweep >> /var/log/asic-monitor-cron.log 2>&1
```

### Descomissionamento (pendente)

Vercel e o projeto Supabase Cloud antigo (`asicmonitor`) devem ser
desligados/rebaixados **somente depois de alguns dias de operação estável**
na VPS — sem pressa, e não unilateralmente. Enquanto isso, ambos continuam
existindo como rede de segurança, mas não recebem tráfego real.

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
- Nenhuma seed phrase ou chave privada de carteira deve existir na VPS ou no app. O BitCart usa só o endereço público BSC do dono (watch-only).
