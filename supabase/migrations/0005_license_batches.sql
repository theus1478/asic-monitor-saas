do $$ begin
  create type public.license_batch_status as enum ('pending', 'active', 'expired', 'cancelled');
exception when duplicate_object then null; end $$;

create table if not exists public.license_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid unique references public.invoices(id) on delete set null,
  quantity integer not null check (quantity > 0),
  status public.license_batch_status not null default 'pending',
  starts_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status <> 'active') or (starts_at is not null and expires_at is not null))
);

create index if not exists license_batches_org_expiry on public.license_batches (organization_id, status, expires_at);
alter table public.license_batches enable row level security;

drop policy if exists "Members can read subscriptions" on public.subscriptions;
create policy "Members can read subscriptions" on public.subscriptions for select to authenticated
using (organization_id in (select organization_id from public.memberships where user_id = (select auth.uid())));
drop policy if exists "Members can create subscriptions" on public.subscriptions;
create policy "Members can create subscriptions" on public.subscriptions for insert to authenticated
with check (organization_id in (select organization_id from public.memberships where user_id = (select auth.uid())));

drop policy if exists "Members can read invoices" on public.invoices;
create policy "Members can read invoices" on public.invoices for select to authenticated
using (organization_id in (select organization_id from public.memberships where user_id = (select auth.uid())));
drop policy if exists "Members can create invoices" on public.invoices;
create policy "Members can create invoices" on public.invoices for insert to authenticated
with check (organization_id in (select organization_id from public.memberships where user_id = (select auth.uid())));

create policy "Members can read license batches" on public.license_batches for select to authenticated
using (organization_id in (select organization_id from public.memberships where user_id = (select auth.uid())));
create policy "Members can create pending license batches" on public.license_batches for insert to authenticated
with check (status = 'pending' and organization_id in (select organization_id from public.memberships where user_id = (select auth.uid())));

drop policy if exists "Members can delete farms in their organization" on public.farms;
create policy "Members can delete farms in their organization" on public.farms for delete to authenticated
using (organization_id in (select organization_id from public.memberships where user_id = (select auth.uid())));

-- Mantém as máquinas já cadastradas funcionando quando a regra entra em vigor.
insert into public.license_batches (organization_id, quantity, status, starts_at, expires_at)
select f.organization_id, count(m.id)::integer, 'active', now(), now() + interval '30 days'
from public.farms f join public.miners m on m.farm_id = f.id
where not exists (select 1 from public.license_batches lb where lb.organization_id = f.organization_id)
group by f.organization_id having count(m.id) > 0;
