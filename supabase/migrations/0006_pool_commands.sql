-- Fila de comandos executados pelos coletores dentro da rede local.
-- O payload inclui credenciais cifradas pela aplicação e não é exposto por RLS.

create table if not exists public.pool_commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  farm_id uuid not null references public.farms(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  kind text not null default 'pool_update' check (kind = 'pool_update'),
  encrypted_payload text not null,
  pool_url text not null,
  target_count integer not null check (target_count > 0),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'succeeded', 'partial', 'failed', 'expired')),
  result jsonb,
  requested_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '15 minutes')
);

create index if not exists pool_commands_agent_queue_idx
  on public.pool_commands(agent_id, status, created_at);

create index if not exists pool_commands_farm_history_idx
  on public.pool_commands(farm_id, created_at desc);

alter table public.pool_commands enable row level security;

create policy "Members can read pool command history"
  on public.pool_commands for select
  to authenticated
  using (
    organization_id in (
      select organization_id from public.memberships
      where user_id = (select auth.uid())
    )
  );
