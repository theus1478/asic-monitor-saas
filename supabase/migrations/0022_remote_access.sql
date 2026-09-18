-- Acesso remoto à tela original da ASIC (túnel pelo coletor + relay).
-- Desligado por padrão em cada fazenda; só owner/operator abrem a máquina.

alter table public.farms add column if not exists remote_access_enabled boolean not null default false;

-- Porta da tela web da ASIC (o painel assumia 80 fixo).
alter table public.miners add column if not exists web_port integer not null default 80
  check (web_port between 1 and 65535);

create table if not exists public.remote_access_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  miner_id uuid references public.miners(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  action text not null default 'open',
  ip text,
  created_at timestamptz not null default now()
);

create index if not exists remote_access_logs_org_created on public.remote_access_logs (organization_id, created_at desc);
alter table public.remote_access_logs enable row level security;

drop policy if exists "Members can read remote access logs" on public.remote_access_logs;
create policy "Members can read remote access logs" on public.remote_access_logs for select to authenticated
using (organization_id in (select organization_id from public.memberships where user_id = (select auth.uid())));
-- Escrita só pelo backend (service role), que já valida papel e fazenda.
