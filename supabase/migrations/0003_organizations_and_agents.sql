-- Cada usuário passa a ter uma organização própria automaticamente ao se
-- cadastrar, e as tabelas de fazenda/agente/máquina ganham políticas reais
-- para leitura e escrita pelos membros da organização.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  new_org_id uuid;
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

  return new;
end;
$$;

-- Backfill: cria organização para perfis que já existiam antes desta migration
-- e ainda não têm nenhuma associação.
do $$
declare
  r record;
  new_org_id uuid;
begin
  for r in
    select p.id as user_id, p.full_name, u.email
    from public.profiles p
    join auth.users u on u.id = p.id
    where not exists (select 1 from public.memberships m where m.user_id = p.id)
  loop
    insert into public.organizations (name, slug)
    values (
      coalesce(r.full_name, split_part(r.email, '@', 1)) || ' — organização',
      'org-' || replace(r.user_id::text, '-', '')
    )
    returning id into new_org_id;

    insert into public.memberships (organization_id, user_id, role)
    values (new_org_id, r.user_id, 'owner');
  end loop;
end $$;

create policy "Members can read their organization"
  on public.organizations for select
  to authenticated
  using (id in (select organization_id from public.memberships where user_id = (select auth.uid())));

create policy "Members can read farms in their organization"
  on public.farms for select
  to authenticated
  using (organization_id in (select organization_id from public.memberships where user_id = (select auth.uid())));

create policy "Members can create farms in their organization"
  on public.farms for insert
  to authenticated
  with check (organization_id in (select organization_id from public.memberships where user_id = (select auth.uid())));

create policy "Members can read agents of their farms"
  on public.agents for select
  to authenticated
  using (farm_id in (select id from public.farms where organization_id in (select organization_id from public.memberships where user_id = (select auth.uid()))));

create policy "Members can create agents for their farms"
  on public.agents for insert
  to authenticated
  with check (farm_id in (select id from public.farms where organization_id in (select organization_id from public.memberships where user_id = (select auth.uid()))));

create policy "Members can read miners of their farms"
  on public.miners for select
  to authenticated
  using (farm_id in (select id from public.farms where organization_id in (select organization_id from public.memberships where user_id = (select auth.uid()))));

create policy "Members can create miners for their farms"
  on public.miners for insert
  to authenticated
  with check (farm_id in (select id from public.farms where organization_id in (select organization_id from public.memberships where user_id = (select auth.uid()))));

create policy "Members can read metrics of their farms"
  on public.miner_metrics for select
  to authenticated
  using (miner_id in (select id from public.miners where farm_id in (select id from public.farms where organization_id in (select organization_id from public.memberships where user_id = (select auth.uid())))));
