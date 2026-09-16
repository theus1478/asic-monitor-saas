# Arquitetura inicial

## Agente local, não navegador

Um navegador não pode varrer IPs da rede local nem abrir sockets TCP para a porta
4028 das ASICs. Por isso o produto terá um executável Windows sem interface,
instalado como serviço no PC principal da fazenda. Ele inicia com o Windows,
faz as leituras locais e envia somente os resultados para a API em nuvem.

```mermaid
flowchart LR
  A[ASICs na LAN\nporta 4028] --> B[Agente no PC da fazenda]
  B -->|HTTPS de saída| C[API Cloud]
  C --> D[(Postgres)]
  C --> E[Assinaturas]
  F[Cliente em qualquer navegador] --> G[Painel web]
  G --> C
```

## Infraestrutura proposta

| Necessidade | Serviço inicial |
| --- | --- |
| Painel e API | Next.js em Vercel |
| Banco de dados | Postgres gerenciado |
| Autenticação | Organizações e permissões por usuário |
| Assinaturas | Faturas em USDT na rede Solana e monitoramento on-chain |
| Agente | Python empacotado como serviço Windows sem interface |

## Entidades

- **User**: pessoa que faz login.
- **Organization**: conta comercial do cliente.
- **Farm**: fazenda dentro de uma organização.
- **Agent**: instalação autorizada no PC da fazenda.
- **Miner**: ASIC cadastrada manualmente.
- **Metric**: leitura enviada pelo agente.
- **Subscription**: licença e estado da assinatura.

## Painel administrativo

O SaaS tem uma área exclusiva para operadores, em `/admin`, acessível somente
por usuários com `profiles.platform_admin = true` (`requirePlatformAdmin()` em
`apps/web/lib/org-data.ts`, redireciona pro `/dashboard` do cliente caso
contrário). Essa área não usa o escopo de uma organização de cliente e permite
controlar a operação inteira. Uma conta com esse papel vê um atalho fixo
("⚙ Painel admin", `apps/web/app/components.tsx`) no canto superior direito de
qualquer página do painel do cliente — o login sempre cai no dashboard normal
primeiro, o atalho é o caminho pra alternar pro `/admin`.

### Implementado hoje

- `/admin`: lista todas as organizações com e-mail do dono, nº de máquinas,
  hashrate total (mesma lógica de "fresco" do dashboard do cliente, 90s),
  licenças ativas e última fatura. Card de hashrate total da plataforma.
- `/admin/orgs/[id]`: detalhe por organização — métricas (máquinas online,
  hashrate, consumo, licenças ativas), membros, máquinas, faturas e lotes de
  licença.
- Reset de senha de qualquer usuário a partir do painel admin
  (`apps/web/app/admin/user-actions.ts`): dispara o fluxo padrão de
  "esqueci minha senha" do Supabase (`resetPasswordForEmail`) para o e-mail do
  usuário-alvo — o admin nunca vê nem define a senha real, só aciona o e-mail
  de redefinição, e a ação é sempre gateada por `requirePlatformAdmin()`.

### Ainda não implementado

- Bloquear/reativar cliente, suspender coleta, criar licença de demonstração
  pela UI (hoje licenças extras são inseridas manualmente via SQL/Supabase).
- Gerar/revogar código de ativação de agente pelo painel admin.
- Indicadores agregados de receita recorrente e inadimplência.

### Papéis

| Papel | Permissão |
| --- | --- |
| `platform_admin` | Administração global do SaaS e suporte a clientes |
| `org_owner` | Assinatura, usuários, fazendas e máquinas da própria organização |
| `org_operator` | Visualização e operação das fazendas autorizadas |
| `org_viewer` | Somente leitura do painel |

## Licença e cobrança

Máquinas cadastradas e ativas contam para a cobrança. A plataforma compara o total ativo com a quantidade licenciada. Preço único de US$ 1,00 por máquina/mês (`apps/web/lib/pricing.ts`, `DEFAULT_PRICING_TIERS`), sem faixas por volume — configurável futuramente pelo painel admin, hoje vive só no código.

Toda organização nova ganha automaticamente um lote de **3 licenças grátis,
válidas por 30 dias**, criado pelo mesmo trigger que cria a organização no
cadastro (`handle_new_user()`, `supabase/migrations/0008_free_trial_licenses.sql`).
A migration também faz backfill: qualquer organização já existente sem nenhum
lote de licença recebe o mesmo trial retroativamente. Licenças extras (pagas
ou de cortesia) hoje são criadas manualmente via SQL Editor do Supabase,
inserindo direto na tabela `license_batches` — não existe fluxo de UI para
isso ainda (ver "Ainda não implementado" no painel administrativo).

## Autenticação e captcha

O login e o cadastro exigem verificação do **Cloudflare Turnstile** quando
`NEXT_PUBLIC_TURNSTILE_SITE_KEY` está configurada (local e produção usam a
mesma site key, com os domínios `localhost`, `127.0.0.1` e o domínio de
produção liberados no widget, no dashboard do Cloudflare). O secret key
correspondente fica configurado em Supabase → Authentication → Attack
Protection, então a verificação acontece nativamente dentro do
`signInWithPassword`/`signUp` do Supabase Auth — o código do app só precisa
repassar o `cf-turnstile-response` recebido do formulário.

O widget é renderizado por um componente cliente dedicado
(`apps/web/app/turnstile-widget.tsx`) que monta o widget via
`window.turnstile.render(...)` depois do `useEffect`, em vez do modo
implícito (`data-sitekey` direto no HTML). O modo implícito causava um erro
de hidratação nessa página (Server Component): o script preenchia a div antes
do React terminar de hidratar, o React descartava a árvore e recriava do
zero no cliente, e como o script só faz o auto-scan uma vez, o widget nunca
mais aparecia — o usuário ficava preso na mensagem "Confirme que você não é
um robô." para sempre. Qualquer novo lugar que precise do captcha deve
reusar esse componente, não o padrão `data-sitekey`.

## Pagamentos em USDT

O SaaS não depende de uma exchange para receber pagamentos: monitora os
pagamentos diretamente na blockchain, na rede **Solana**. Cada fatura recebe um
**endereço de depósito exclusivo**, não uma carteira compartilhada — é isso que
permite identificar quem pagou mesmo quando o pagamento vem sem memo/tag, como
um saque direto de exchange (Binance etc. não deixam anexar memo num saque de
Solana).

1. Ao gerar uma fatura, `createLicensePurchase` (`app/billing/actions.ts`)
   deriva um par de chaves Solana exclusivo para aquela fatura e grava só o
   endereço público (`invoices.wallet_address` / `deposit_address`).
2. O painel mostra esse endereço, QR Code (Solana Pay URI), valor e status
   pendente. O QR e o endereço copiável apontam para o endereço da própria
   fatura, não para uma carteira fixa do sistema.
3. `verifyLicensePurchase` consulta a rede Solana pelas transferências USDT
   recebidas *naquele endereço específico*; qualquer valor recebido lá já
   identifica a fatura, sem depender de memo ou de um valor fracionário único.
4. Após confirmar, o sistema varre (sweep) o saldo do endereço da fatura para
   a carteira de tesouraria (`BILLING_WALLET_PUBLIC_KEY`), registrando
   `invoices.swept_at`/`sweep_signature`. Se a varredura falhar, o pagamento já
   fica confirmado mesmo assim — o saldo continua seguro no endereço da fatura
   até a próxima tentativa, já que a chave privada é recalculável a qualquer momento.
5. A confirmação ativa ou renova a licença automaticamente.
6. O pagamento atrasado aplica período de tolerância e, depois, suspende coleta
   e acesso até a regularização, sem apagar os dados do cliente.

### Custódia das chaves (`lib/solana-wallet.ts`)

Nenhuma chave privada de fatura é persistida. `deriveInvoiceKeypair(reference)`
recalcula o par de chaves sob demanda via HMAC-SHA512 de uma semente mestra
(`INVOICE_DERIVATION_SEED`, variável de ambiente só no servidor) com a
referência da fatura como mensagem, truncado a 32 bytes e usado como seed
Ed25519. A mesma referência sempre deriva o mesmo endereço; referências
diferentes derivam endereços diferentes — não há como recuperar a chave
mestra a partir de um endereço derivado.

A varredura (sweep) usa uma segunda carteira, dedicada e de baixo valor — a
"carteira de combustível" (`FEE_PAYER_SECRET_KEY`) — que só paga a taxa de rede
da transação de varredura. A carteira de tesouraria (`BILLING_WALLET_PUBLIC_KEY`)
nunca precisa da própria chave privada no servidor: quem assina a varredura é o
par derivado da fatura (dono do token account de origem) e a carteira de
combustível (paga a taxa). Um comprometimento da carteira de combustível não dá
acesso aos fundos do cliente nem da tesouraria — na pior hipótese, alguém gasta
o pouco SOL nela depositado para cobrir taxas.

## Ocorrências, alertas e logs em tempo real (`lib/asic-alerts/`)

Motor de regras centralizado que roda em cima da telemetria já existente —
não é um sistema paralelo. Fluxo: `POST /api/agent/metrics` insere a
leitura, lê o estado anterior da mesma máquina, normaliza os dois
(`normalize.ts`) e roda cada regra (`rules.ts`) comparando contra a
configuração da organização (`alert_settings`, com defaults sensatos e
personalizável por org). Cada regra que "bate" vira uma linha em
`asic_incidents` — uma só por `(miner_id, rule_key)` enquanto o problema
persiste (índice único parcial), atualizada a cada ciclo em vez de duplicada;
quando a regra para de bater, a ocorrência é resolvida automaticamente e um
evento de recuperação é gravado. `asic_events` guarda o log curado (o que
aparece na tela "Eventos recentes" da máquina); não existe uma tabela de log
bruto — o payload que o agente já envia a cada ciclo (`miner_metrics.payload`)
já é o dado bruto, reconstituído sob demanda em vez de duplicado.

- **Regras implementadas:** `reboot_detected` (queda de uptime), `hashboard_failure`
  (placa que zera ou some do relatório), `zero_hashrate`, `hashrate_degraded`
  (contra a própria média saudável da máquina — `miners.baseline_hashrate_ths`,
  uma média móvel lenta, não um catálogo fixo de TH/s por modelo, que seria
  inventado), `temperature_high` (dois níveis, warning/critical) e `fan_failure`
  (best-effort, só quando o firmware reporta RPM).
- **`miner_offline`** não dá pra detectar dentro do POST (é ausência de dado que
  importa) — usa o mesmo padrão já existente em `lib/affiliate.ts`
  (`releaseMaturedCommissions`): checagem "preguiçosa" a cada carregamento da
  Visão Geral/página da fazenda (`offline-sweep.ts`), com um cron diário como
  backstop (`/api/cron/asic-health-sweep` — diário porque o único cron já
  existente no projeto roda 1x/dia, sinal de que não dá pra agendar algo mais
  frequente no plano atual do Vercel).
- **Deduplicação e anti-spam:** e-mail só sai se `alert_settings.email_enabled`,
  a regra não estiver desabilitada, e (a) é a primeira detecção ou (b) já
  passou `reminder_cooldown_minutes` desde o último e-mail daquela ocorrência.
  `hashrate_degraded` também exige a ocorrência ativa há pelo menos
  `hashrate_window_minutes` antes do primeiro e-mail (não é o valor isolado de
  uma leitura). Falha no envio (Resend, via `email.ts`) nunca bloqueia o resto
  do pipeline nem marca a ocorrência como notificada — fica registrada em
  `alert_notifications` como `failed` e a próxima tentativa não espera o
  cooldown inteiro.
- **Reconhecer ≠ resolver:** `status` tem três valores (`active`, `acknowledged`,
  `resolved`); reconhecer só marca quem/quando (`acknowledged_by/_at`) — o
  motor continua atualizando e pode resolver normalmente uma ocorrência
  reconhecida (por isso o índice único cobre `active` e `acknowledged` juntos).
- **Saúde da máquina** (🟢🟡🔴⚫ no `farms/[id]`) é sempre derivada das
  ocorrências ativas daquela máquina, nunca um campo separado que possa
  divergir delas.

Requer `RESEND_API_KEY` (e opcionalmente `ALERT_EMAIL_FROM`) configurada no
Vercel — sem ela, o motor continua registrando ocorrências normalmente, só o
e-mail fica marcado como `skipped`.

## Fases

1. Contas, organizações, fazendas, serviço coletor e ingestão de métricas.
2. Painel multiempresa e cadastro manual de ASICs.
3. Stripe, licença por máquina e bloqueio por assinatura.
4. Instalador Windows, atualização automática e alertas.
