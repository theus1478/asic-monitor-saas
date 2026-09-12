create type public.app_role as enum ('owner', 'admin', 'operator', 'viewer');
create type public.subscription_status as enum ('trial', 'active', 'past_due', 'suspended', 'cancelled');
create type public.invoice_status as enum ('draft', 'pending', 'paid', 'expired', 'cancelled');

create table public.organizations (
  id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique,
  status public.subscription_status not null default 'trial', created_at timestamptz not null default now()
);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade, full_name text,
  platform_admin boolean not null default false, created_at timestamptz not null default now()
);
create table public.memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null default 'viewer', primary key (organization_id, user_id)
);
create table public.farms (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, timezone text not null default 'America/Sao_Paulo', created_at timestamptz not null default now()
);
create table public.agents (
  id uuid primary key default gen_random_uuid(), farm_id uuid not null references public.farms(id) on delete cascade,
  name text not null, token_hash text not null unique, status text not null default 'offline', last_seen_at timestamptz
);
create table public.miners (
  id uuid primary key default gen_random_uuid(), farm_id uuid not null references public.farms(id) on delete cascade,
  name text not null, ip inet not null, model text, protocol_port integer not null default 4028,
  enabled boolean not null default true, created_at timestamptz not null default now(), unique (farm_id, ip)
);
create table public.miner_metrics (
  id bigint generated always as identity primary key, miner_id uuid not null references public.miners(id) on delete cascade,
  observed_at timestamptz not null, online boolean not null, hashrate_ths numeric, temperature_c numeric,
  power_w numeric, payload jsonb not null default '{}'::jsonb
);
create index miner_metrics_by_miner_time on public.miner_metrics (miner_id, observed_at desc);
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null unique references public.organizations(id) on delete cascade,
  licensed_machines integer not null check (licensed_machines >= 0), status public.subscription_status not null default 'trial',
  current_period_end timestamptz, created_at timestamptz not null default now()
);
create table public.invoices (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid not null references public.subscriptions(id) on delete cascade, reference text not null unique,
  amount_usdt numeric(18,6) not null check (amount_usdt > 0), wallet_address text not null, network text not null default 'solana',
  status public.invoice_status not null default 'pending', due_at timestamptz not null, paid_at timestamptz, transaction_signature text unique,
  created_at timestamptz not null default now()
);

alter table public.organizations enable row level security;
alter table public.farms enable row level security;
alter table public.miners enable row level security;
alter table public.miner_metrics enable row level security;
alter table public.subscriptions enable row level security;
alter table public.invoices enable row level security;
-- As políticas por organização serão aplicadas junto ao middleware de autenticação.
