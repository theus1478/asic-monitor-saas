# AGENTS.md — ASIC Monitor Cloud

Contexto para agentes de código (Codex, Claude Code etc.). Leia isto primeiro, depois
`README.md`, `docs/architecture.md` (arquitetura e regras do produto) e
`docs/configuration.md` (operação/infra). **Nunca** coloque segredos, chaves ou tokens
neste repositório nem nas docs.

## O que é

SaaS de monitoramento de fazendas ASIC (Antminer, Whatsminer, Avalon). O cliente instala
um coletor Windows no PC da fazenda; ele lê as máquinas na LAN, envia telemetria e
comandos para a nuvem e (opcionalmente) abre um túnel de saída para o acesso remoto à
tela da ASIC. Licença: US$ 1,00 por máquina/mês, paga em USDT (Solana).

- Repositório: `theus1478/asic-monitor-saas`, branch `main`. Idioma do produto e das
  docs: **português (pt-BR)**; a interface também tem en, es, pl, ru.
- O projeto irmão `asic-monitor` (painel local antigo) é **outro** repositório.

## Estrutura

| Caminho | O quê |
| --- | --- |
| `apps/web` | Painel + API (Next.js 16 App Router, Server Actions, `output: "standalone"`, next-intl, Supabase). Comandos: `npm run dev` / `build` / `lint` e `npx tsc --noEmit` |
| `apps/agent` | Coletor Python (`gui_app.py` Tk + `miners.py` + `tunnel.py`), empacotado em `.exe` com PyInstaller (ver `apps/agent/README.md`). Testes: `python -m pytest` |
| `apps/relay` | Relay do acesso remoto (Node 20 + `ws`). Teste ponta a ponta: `npm test` (com `E2E_PY_AGENT=python` usa o coletor real) |
| `supabase/migrations` | SQL numerado (`0001`…`0022`), aplicado **à mão** na VPS (não há CLI de migração) |
| `docs` | `architecture.md` e `configuration.md` — mantenha atualizados junto com o código |

Arquivos-chave: `apps/web/lib/asic-alerts/` (incidentes/alertas), `lib/license.ts` +
`license_batches` (licenças), `lib/remote-access.ts` + `app/farms/[id]/remote-access.ts`
(acesso remoto), `app/farms/[id]/legacy-monitor.tsx` (tela de monitoramento),
`app/mobile.css` (todo o layout de celular/tablet), `app/api/agent/*` (API do coletor).

## Infra (produção)

- **VPS** Hostinger KVM1 (`2.25.234.75`, Ubuntu, 1 vCPU/4 GB), **EasyPanel** (Docker
  Swarm + Traefik). Projeto `asic-monitor` com os apps `web` (`monitorasic.club`) e
  `relay` (`relay.monitorasic.club`). Deploy: fonte GitHub `main`, sem auto-deploy —
  disparado pelo hook do serviço no EasyPanel. Depois de um deploy, **confirme que o
  código novo entrou** (o EasyPanel já reutilizou código antigo uma vez).
- **Banco**: Supabase self-hosted na mesma VPS (`db.monitorasic.club`), container
  `supabase-db`. Vercel e Supabase Cloud antigos estão **pausados** (não apagados).
- **Acesso remoto**: wildcard `*.remote.monitorasic.club` com certificado do `lego`
  (DNS-01 na Dynadot), rota do Traefik em `/etc/easypanel/traefik/config/remote.yaml`.
- Segredos ficam **só** no EasyPanel (env dos serviços) e na VPS (`/root/secrets`).
  Detalhes e variáveis: `docs/configuration.md`.

## Regras que já custaram caro

- **Migration antes do código** que usa a coluna nova (o `/api/agent/config` quebra a
  telemetria de todas as fazendas se ler coluna inexistente).
- Nunca inline aspas em `ssh` pelo PowerShell: escreva um `.sh`/`.sql` em arquivo,
  `scp` para a VPS e execute (detalhes em `docs/configuration.md`).
- Não mude regra de negócio, API do coletor (`/api/agent/*`, compatível com `.exe`
  já instalados) ou banco ao mexer só em UI. Coletores antigos precisam continuar
  funcionando: só acrescente campos, nunca renomeie/remova.
- CSS de celular/tablet fica **só** em `apps/web/app/mobile.css`, dentro de
  `@media (max-width: …)`; acima de 900 px o desktop não deve mudar. Tabelas do
  painel usam `.table-wrap` (viram cards no celular; ver `stack-tables.tsx`).
- Textos de interface vão nos 5 arquivos de `apps/web/messages/*.json` (mesmas chaves).
- Depois de editar: `npx tsc --noEmit` e `npx eslint` em `apps/web` (hoje só há 2
  avisos antigos em `legacy-monitor.tsx`), testes do relay/coletor se mexeu neles.
- Commits em português ou inglês curtos; não versione `HANDOFF.md`, `.env*`,
  `.next`, `node_modules`, builds do PyInstaller.

## Estado atual (2026-09-19)

Funcionando em produção: monitoramento, alertas (incidentes se resolvem sozinhos),
painel admin unificado (usuários, licenças manuais, senha temporária por e-mail),
pagamento em USDT/Solana (BitCart foi testado e abandonado), acesso remoto à tela da
ASIC (coletor 0.11.0+; botão 🌐 no IP e "Acessar máquina"), layout responsivo para
celular/tablet.

Pendências conhecidas: `SITE_URL`/`API_EXTERNAL_URL` do Supabase ainda apontam para o
IP; captcha (Turnstile) não é validado no GoTrue; a carteira que paga taxas da Solana
precisa de um pouco de SOL; WebSocket dentro da tela da ASIC (acesso remoto) responde
501; a porta web da máquina (`miners.web_port`) ainda não tem tela de edição; possível
lentidão de rota entre operadoras brasileiras e a VPS (ver "Diagnóstico de lentidão" em
`docs/configuration.md`).
