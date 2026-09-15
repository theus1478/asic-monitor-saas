-- Permite excluir uma máquina específica (antes só dava pra excluir a fazenda inteira).
create policy "Members can delete miners in their organization" on public.miners for delete to authenticated
using (
  farm_id in (
    select id from public.farms
    where organization_id in (select organization_id from public.memberships where user_id = (select auth.uid()))
  )
);

-- pool_commands ganha o tipo 'reboot' (reiniciar a máquina) além da troca de pool.
-- Reboot não tem pool_url; a coluna vira opcional.
alter table public.pool_commands alter column pool_url drop not null;
alter table public.pool_commands drop constraint if exists pool_commands_kind_check;
alter table public.pool_commands add constraint pool_commands_kind_check check (kind in ('pool_update', 'reboot'));

-- Configuração única da plataforma: hoje só a chave da API-Ninjas usada pela
-- calculadora de rendimento de todos os clientes. Só o service role lê/escreve
-- (sem policy pra authenticated) — o admin passa pela server action com o
-- client de serviço, depois de checar platform_admin em código.
create table if not exists public.platform_settings (
  id boolean primary key default true check (id),
  api_ninjas_key text,
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (id) values (true) on conflict (id) do nothing;
alter table public.platform_settings enable row level security;
