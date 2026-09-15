# ASIC Monitor Cloud

Plataforma SaaS para monitoramento de fazendas ASIC. Cada cliente instala um
executável sem interface no computador principal da fazenda; ele consulta as
máquinas na rede local e envia métricas para a nuvem em segundo plano.

## Componentes

- `apps/web`: painel em nuvem, contas, organizações, fazendas e cobrança.
- `apps/agent`: serviço Windows sem interface instalado pelo cliente.
- `packages/contracts`: mensagens entre agente e API.
- `docs`: decisões de arquitetura e regras do produto.

## Modelo de acesso

1. O cliente se cadastra (login protegido por captcha Cloudflare Turnstile) e
   ganha uma organização automaticamente, já com **3 licenças grátis por 30
   dias** para testar a plataforma.
2. Ele cria uma fazenda e recebe um código de instalação temporário.
3. O agente usa o código uma vez e recebe sua própria credencial.
4. O agente consulta as ASICs na LAN e envia métricas a cada intervalo.
5. O cliente vê o mesmo painel de qualquer dispositivo com sua conta.

Além do painel do cliente, a plataforma tem uma área administrativa global
(`/admin`, restrita a contas com `profiles.platform_admin = true`) para
consultar todos os clientes, hashrate e faturas por organização, e resetar
senha de qualquer usuário. Quem tem esse papel vê um atalho fixo "⚙ Painel
admin" no canto superior direito de qualquer página do painel do cliente.

Preço: **US$ 1,00 por máquina ativa/mês**, valor único, sem faixas por volume. As faturas mensais serão pagas em **USDT na rede Solana**, com conferência automática na blockchain.

Leia [a arquitetura](docs/architecture.md) antes de iniciar a implementação.
