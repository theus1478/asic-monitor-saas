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

1. O cliente cria uma organização e contrata uma assinatura.
2. Ele cria uma fazenda e recebe um código de instalação temporário.
3. O agente usa o código uma vez e recebe sua própria credencial.
4. O agente consulta as ASICs na LAN e envia métricas a cada intervalo.
5. O cliente vê o mesmo painel de qualquer dispositivo com sua conta.

Além do painel do cliente, a plataforma terá uma área administrativa global para
controlar clientes, acessos, licenças, agentes, fazendas, cobranças e suporte.

Preço-base: **US$ 3,00 por máquina ativa/mês**. Descontos por volume serão configuráveis no banco para não depender de alteração de código. As faturas mensais serão pagas em **USDT na rede Solana**, com conferência automática na blockchain.

Leia [a arquitetura](docs/architecture.md) antes de iniciar a implementação.
