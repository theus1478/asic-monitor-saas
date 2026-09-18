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

**Capacidade do banco:** o projeto roda hoje no plano Free, instância
`t3.nano` (compute compartilhado, sem núcleo dedicado). Em 2026-09-17 essa
instância foi observada em ~98% de CPU / 85% de memória / 78% de Disk IO
(Settings → Infrastructure no painel), causando timeouts de conexão em
consultas simples e lentidão perceptível no login — não é bug de código, é
teto de capacidade do plano. Upgrade de compute exige plano Pro. Se o site
estiver lento/instável, checar esse painel antes de investigar o app.

As rotas `/dashboard`, `/farms`, `/billing` e `/admin` exigem uma sessão válida. O cadastro cria automaticamente um registro em `profiles` por meio da migration `0002_auth_profiles.sql`.

## Aplicação Vercel

| Variável | Uso |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | URL canônica do painel após o primeiro deploy |
| `AGENT_TOKEN_PEPPER` | Segredo usado para gerar hashes dos tokens dos agentes |
| `SOLANA_RPC_URL` | Endpoint RPC para o monitor on-chain validar transferências USDT (ainda não implementado) |
| `NEXT_PUBLIC_SOLANA_USDT_MINT` | Endereço do mint do USDT na rede Solana. Usado no QR code de pagamento (Solana Pay), por isso é público — não é segredo. |
| `NEXT_PUBLIC_BILLING_WALLET_PUBLIC_KEY` | Endereço público que recebe USDT. Público por natureza (é para onde o cliente paga), exposto no navegador para montar o QR code da fatura. |
| `RESEND_API_KEY` | Envio de e-mail transacional (alertas de ocorrência e o código de confirmação de 6 dígitos no cadastro/troca de e-mail) via Resend. Sem ela, ocorrências continuam sendo registradas normalmente (só o e-mail fica `skipped`), mas cadastro/verificação de e-mail não funcionam — é a única credencial nova que virou obrigatória pro fluxo principal de cadastro. |
| `ALERT_EMAIL_FROM` | Remetente usado nos e-mails acima. Opcional — sem ela, usa `ASIC Monitor <alerts@resend.dev>`. |

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
