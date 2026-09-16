-- Programa de afiliados: indicação de novos clientes com comissão recorrente
-- sobre o valor efetivamente pago por eles em licenças.
--
-- Fluxo: usuário vira afiliado (perfil criado sob demanda, código único) ->
-- compartilha link/código -> novo cadastro é vinculado a ele (uma vez só,
-- gravado no handle_new_user, nunca só no frontend) -> cada fatura paga do
-- indicado gera uma comissão PENDING (uma por compra, UNIQUE em purchase_id)
-- -> 30 dias depois da confirmação do pagamento (não do cadastro) ela vira
-- AVAILABLE, a menos que a compra tenha sido cancelada -> admin registra
-- pagamento em lote, comissões viram PAID e ficam amarradas ao payout.

do $$ begin
  create type public.affiliate_commission_status as enum ('pending', 'available', 'paid', 'canceled', 'reversed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.affiliate_status as enum ('active', 'suspended');
exception when duplicate_object then null; end $$;

-- Configuração global do programa. Cada comissão grava sua própria taxa no
-- momento da criação (commission_rate em affiliate_commissions) para que uma
-- mudança futura aqui nunca recalcule comissões já geradas.
alter table public.platform_settings add column if not exists affiliate_program_enabled boolean not null default true;
alter table public.platform_settings add column if not exists affiliate_default_commission_rate numeric(5,2) not null default 10.00 check (affiliate_default_commission_rate >= 0 and affiliate_default_commission_rate <= 100);
alter table public.platform_settings add column if not exists affiliate_hold_period_days integer not null default 30 check (affiliate_hold_period_days >= 0);
alter table public.platform_settings add column if not exists affiliate_referral_validity_days integer not null default 30 check (affiliate_referral_validity_days >= 0);

create table public.affiliate_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  affiliate_code text not null unique,
  commission_rate numeric(5,2) not null check (commission_rate >= 0 and commission_rate <= 100),
  status public.affiliate_status not null default 'active',
  created_at timestamptz not null default now()
);
create index affiliate_profiles_code on public.affiliate_profiles (affiliate_code);

-- Cada usuário só pode ter sido indicado por um único afiliado, para sempre
-- (referred_user_id é UNIQUE). Trocar de afiliado depois exige uma ação
-- administrativa explícita e auditada (ver affiliate_audit_log).
create table public.affiliate_referrals (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliate_profiles(id) on delete cascade,
  referred_user_id uuid not null unique references public.profiles(id) on delete cascade,
  referral_code text not null,
  source text not null default 'link',
  referred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index affiliate_referrals_by_affiliate on public.affiliate_referrals (affiliate_id);

-- Impede autoindicação: o dono do código de afiliado não pode ser o próprio
-- indicado. Constraint CHECK não alcança outra tabela, por isso é um trigger.
create or replace function public.prevent_affiliate_self_referral()
returns trigger
language plpgsql
as $$
declare
  affiliate_user_id uuid;
begin
  select user_id into affiliate_user_id from public.affiliate_profiles where id = new.affiliate_id;
  if affiliate_user_id = new.referred_user_id then
    raise exception 'Um afiliado não pode indicar a si mesmo';
  end if;
  return new;
end;
$$;
create trigger affiliate_referrals_no_self_referral
  before insert on public.affiliate_referrals
  for each row execute procedure public.prevent_affiliate_self_referral();

-- Uma comissão por compra, sempre. purchase_id é UNIQUE: mesmo que o código
-- de confirmação de pagamento seja chamado mais de uma vez (retry, corrida),
-- o banco recusa a segunda tentativa de gerar comissão para a mesma fatura.
create table public.affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliate_profiles(id) on delete cascade,
  referred_user_id uuid not null references public.profiles(id) on delete cascade,
  purchase_id uuid not null unique references public.invoices(id) on delete restrict,
  license_quantity integer not null check (license_quantity > 0),
  purchase_amount numeric(18,6) not null check (purchase_amount > 0),
  currency text not null default 'USDT',
  commission_rate numeric(5,2) not null check (commission_rate >= 0 and commission_rate <= 100),
  commission_amount numeric(18,6) not null check (commission_amount >= 0),
  status public.affiliate_commission_status not null default 'pending',
  purchase_date timestamptz not null,
  available_at timestamptz not null,
  paid_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index affiliate_commissions_by_affiliate on public.affiliate_commissions (affiliate_id, status);
create index affiliate_commissions_pending_release on public.affiliate_commissions (status, available_at) where status = 'pending';

create table public.affiliate_payouts (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliate_profiles(id) on delete cascade,
  amount numeric(18,6) not null check (amount > 0),
  currency text not null default 'USDT',
  payment_method text not null,
  payment_reference text,
  notes text,
  status text not null default 'completed' check (status in ('completed', 'failed')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index affiliate_payouts_by_affiliate on public.affiliate_payouts (affiliate_id);

-- Liga cada comissão paga ao payout que a pagou. commission_id é UNIQUE: uma
-- comissão só pode fazer parte de um pagamento na vida inteira.
create table public.affiliate_payout_items (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references public.affiliate_payouts(id) on delete cascade,
  commission_id uuid not null unique references public.affiliate_commissions(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.affiliate_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.profiles(id),
  action text not null,
  affected_user_id uuid references public.profiles(id),
  affected_commission_id uuid references public.affiliate_commissions(id),
  affected_payout_id uuid references public.affiliate_payouts(id),
  previous_value jsonb,
  new_value jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index affiliate_audit_log_recent on public.affiliate_audit_log (created_at desc);

-- handle_new_user ganha um terceiro parâmetro implícito: se o cadastro veio
-- com um código de indicação (raw_user_meta_data ->> 'referral_code'), grava
-- o vínculo permanente aqui mesmo, na mesma transação que cria o perfil, a
-- organização e a licença grátis — nunca depende só do que o frontend manda
-- depois.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  new_org_id uuid;
  ref_code text;
  ref_affiliate_id uuid;
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;

  insert into public.organizations (name, slug)
  values (
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)) || ' — organização',
    'org-' || replace(new.id::text, '-', '')
  )
  returning id into new_org_id;

  insert into public.memberships (organization_id, user_id, role)
  values (new_org_id, new.id, 'owner')
  on conflict do nothing;

  insert into public.license_batches (organization_id, quantity, status, starts_at, expires_at)
  values (new_org_id, 3, 'active', now(), now() + interval '30 days');

  ref_code := nullif(trim(new.raw_user_meta_data ->> 'referral_code'), '');
  if ref_code is not null then
    select id into ref_affiliate_id from public.affiliate_profiles
      where upper(affiliate_code) = upper(ref_code) and status = 'active';
    if ref_affiliate_id is not null and ref_affiliate_id <> new.id then
      insert into public.affiliate_referrals (affiliate_id, referred_user_id, referral_code, source)
      values (ref_affiliate_id, new.id, upper(ref_code), 'signup')
      on conflict (referred_user_id) do nothing;
    end if;
  end if;

  return new;
end;
$$;

alter table public.affiliate_profiles enable row level security;
alter table public.affiliate_referrals enable row level security;
alter table public.affiliate_commissions enable row level security;
-- payouts, payout_items e audit_log não recebem policy para "authenticated":
-- só o service role (usado nas server actions do admin, depois de checar
-- platform_admin em código) lê e escreve essas três tabelas.
alter table public.affiliate_payouts enable row level security;
alter table public.affiliate_payout_items enable row level security;
alter table public.affiliate_audit_log enable row level security;

create policy "Users can read their own affiliate profile" on public.affiliate_profiles for select to authenticated
using (user_id = (select auth.uid()));
create policy "Users can create their own affiliate profile" on public.affiliate_profiles for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "Affiliates can read their own referrals" on public.affiliate_referrals for select to authenticated
using (affiliate_id in (select id from public.affiliate_profiles where user_id = (select auth.uid())));

create policy "Affiliates can read their own commissions" on public.affiliate_commissions for select to authenticated
using (affiliate_id in (select id from public.affiliate_profiles where user_id = (select auth.uid())));
