-- Libera 50 licencas gratuitas (30 dias, sem fatura associada - mesmo padrao
-- ja usado no backfill da migration 0005) para todas as organizacoes ja
-- cadastradas na plataforma.

insert into public.license_batches (organization_id, quantity, status, starts_at, expires_at)
select id, 50, 'active', now(), now() + interval '30 days'
from public.organizations;

-- Recalcula o resumo em subscriptions a partir da soma real das licencas
-- ativas (inclui os lotes ja existentes, nao so o lote novo).
insert into public.subscriptions (organization_id, licensed_machines, status, current_period_end)
select
  o.id,
  coalesce((select sum(lb.quantity) from public.license_batches lb where lb.organization_id = o.id and lb.status = 'active' and lb.expires_at > now()), 0),
  'active',
  (select max(lb.expires_at) from public.license_batches lb where lb.organization_id = o.id and lb.status = 'active' and lb.expires_at > now())
from public.organizations o
on conflict (organization_id) do update set
  licensed_machines = excluded.licensed_machines,
  status = 'active',
  current_period_end = excluded.current_period_end;
