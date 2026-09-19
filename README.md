# ASIC Monitor Cloud

Plataforma SaaS para monitoramento de fazendas ASIC. Cada cliente instala um
executável sem interface no computador principal da fazenda; ele consulta as
máquinas na rede local e envia métricas para a nuvem em segundo plano.

## Componentes

- `apps/web`: painel em nuvem, contas, organizações, fazendas e cobrança.
- `apps/agent`: coletor Windows instalado pelo cliente (telemetria, comandos e o
  túnel de acesso remoto).
- `apps/relay`: serviço Node que liga o navegador do cliente à tela da ASIC pelo
  coletor (acesso remoto, sem abrir portas na fazenda).
- `packages/contracts`: mensagens entre agente e API.
- `docs`: decisões de arquitetura e regras do produto.

## Modelo de acesso

1. O cliente se cadastra (login protegido por captcha Cloudflare Turnstile),
   confirma o e-mail com um **código de 6 dígitos** enviado na hora (não é
   mais o link de confirmação do Supabase), e ganha uma organização
   automaticamente, já com **3 licenças grátis por 30 dias** para testar a
   plataforma.
2. Ele cria uma fazenda e recebe um código de instalação temporário.
3. O agente usa o código uma vez e recebe sua própria credencial.
4. O agente consulta as ASICs na LAN e envia métricas a cada intervalo.
5. O cliente vê o mesmo painel de qualquer dispositivo com sua conta. O layout
   é responsivo: no celular e no tablet o menu vira uma barra de abas embaixo,
   as tabelas viram cards e os modais viram folhas inferiores (desktop
   inalterado — ver "Layout responsivo" na arquitetura).
6. Com o **acesso remoto** ligado na fazenda (padrão: desligado), quem é
   owner/admin/operator abre a tela original de qualquer ASIC de fora da rede
   local, pelo botão 🌐 ao lado do IP ou por "Acessar máquina" na máquina. O
   coletor (0.11.0+) abre uma conexão só de saída com o relay; o link é
   temporário, de uso único, e cada acesso é registrado.

Além do painel do cliente, a plataforma tem uma área administrativa global
(`/admin`, restrita a contas com `profiles.platform_role` preenchido —
`admin` ou `super_admin`) para consultar todos os clientes, hashrate e
faturas por organização, e gerenciar o ciclo de vida completo de qualquer
usuário em `/admin/users` (perfil, e-mail, senha, status da conta, nível de
administrador, exclusão reversível, licenças manuais, senha temporária por
e-mail). Quem tem esse papel vê um atalho "⚙ Painel admin" no canto superior
direito de qualquer página do painel do cliente (no celular ele fica no menu ☰).

Preço: **US$ 1,00 por máquina ativa/mês**, valor único, sem faixas por volume. As faturas mensais serão pagas em **USDT na rede Solana**, com conferência automática na blockchain.

Leia [a arquitetura](docs/architecture.md) antes de iniciar a implementação.
