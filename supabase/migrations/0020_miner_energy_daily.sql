-- Rollup diário de energia por máquina, pra parar de recalcular consumo
-- integrando telemetria bruta (até 10.000 linhas de 30 dias) toda vez que o
-- dashboard carrega. A ingestão (POST /api/agent/metrics) já lê a leitura
-- anterior de cada máquina pra comparar "antes vs agora" com o motor de
-- alertas — aproveita essa mesma consulta pra calcular o delta de energia
-- (trapézio entre a leitura anterior e a atual) e incrementa este rollup em
-- vez de o dashboard reconstruir tudo a cada visita.

create table public.miner_energy_daily (
  miner_id uuid not null references public.miners(id) on delete cascade,
  day date not null,
  kwh numeric not null default 0,
  last_observed_at timestamptz,
  primary key (miner_id, day)
);
create index miner_energy_daily_miner_day on public.miner_energy_daily (miner_id, day desc);
alter table public.miner_energy_daily enable row level security;

create policy "Members can read energy of their farms"
  on public.miner_energy_daily for select
  to authenticated
  using (miner_id in (select id from public.miners where farm_id in (select id from public.farms where organization_id in (select organization_id from public.memberships where user_id = (select auth.uid())))));

-- Upsert atômico: soma o delta em vez de sobrescrever, pra suportar chamadas
-- concorrentes de múltiplos agentes sem condição de corrida (um único
-- comando SQL com ON CONFLICT, não select-then-update em dois passos).
create or replace function public.increment_miner_energy(p_miner_id uuid, p_day date, p_kwh numeric, p_last_observed_at timestamptz)
returns void
language sql
security definer set search_path = public
as $$
  insert into public.miner_energy_daily (miner_id, day, kwh, last_observed_at)
  values (p_miner_id, p_day, p_kwh, p_last_observed_at)
  on conflict (miner_id, day) do update
    set kwh = public.miner_energy_daily.kwh + excluded.kwh,
        last_observed_at = excluded.last_observed_at;
$$;
