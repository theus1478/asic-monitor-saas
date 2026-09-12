# Configuração segura

Este documento registra **quais** credenciais o ASIC Monitor SaaS usa e onde configurá-las. Nunca registre valores reais de senhas, tokens, chaves privadas ou seed phrases no GitHub.

## Supabase

Configure em `apps/web/.env.local` para desenvolvimento e em **Vercel → Project Settings → Environment Variables** para produção.

| Variável | Uso | Onde obter |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL pública do projeto | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cliente web com RLS | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Operações administrativas do servidor | Supabase → Project Settings → API; somente Vercel, nunca navegador |

O projeto atual é `asicmonitor` e sua URL é `https://dsycgqvtvaxhfjxmsatw.supabase.co`.

As rotas `/dashboard`, `/farms`, `/billing` e `/admin` exigem uma sessão válida. O cadastro cria automaticamente um registro em `profiles` por meio da migration `0002_auth_profiles.sql`.

## Aplicação Vercel

| Variável | Uso |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | URL canônica do painel após o primeiro deploy |
| `AGENT_TOKEN_PEPPER` | Segredo usado para gerar hashes dos tokens dos agentes |
| `SOLANA_RPC_URL` | Endpoint RPC para validar transferências USDT |
| `SOLANA_USDT_MINT` | Endereço oficial do mint USDT na rede Solana escolhida |
| `BILLING_WALLET_PUBLIC_KEY` | Endereço público que recebe USDT |

Use valores diferentes em Development, Preview e Production quando fizer sentido. Os valores sensíveis ficam somente na Vercel.

## Agente local da fazenda

Cada cliente receberá um arquivo `config.json` baseado em `apps/agent/config.example.json`.

| Campo | Uso |
| --- | --- |
| `api_url` | Endpoint HTTPS da aplicação Vercel |
| `agent_token` | Token exclusivo e revogável de uma fazenda |
| `poll_interval_seconds` | Intervalo de leitura dos ASICs |
| `miners` | Endereços IP locais autorizados para monitoramento |

O agente nunca armazena credenciais Supabase, chave de carteira ou senha do administrador.

## GitHub

O repositório é `theus1478/asic-monitor-saas`. Para automações, use token fine-grained limitado a esse repositório e apenas com permissão **Contents: Read and write**. Defina uma expiração curta e revogue-o quando a configuração terminar.

## Senhas e recuperação

- Guarde senhas de banco, carteiras e contas em um gerenciador de senhas.
- A senha do banco Postgres não deve entrar em `.env`, no código ou no GitHub.
- A seed phrase da carteira Solana nunca deve ser usada pela aplicação. A cobrança utiliza somente a chave pública.
