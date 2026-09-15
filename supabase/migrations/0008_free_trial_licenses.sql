-- Toda conta nova ganha 3 licenças grátis (30 dias) pra testar a plataforma,
-- junto com a organização que já era criada automaticamente.

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

  insert into public.license_batches (organization_id, quantity, status, starts_at, expires_at)
  values (new_org_id, 3, 'active', now(), now() + interval '30 days');

  return new;
end;
$$;

-- Backfill: organizações que já existem e nunca tiveram nenhum lote de
-- licença (nem grátis, nem comprado) ganham as 3 de teste agora.
insert into public.license_batches (organization_id, quantity, status, starts_at, expires_at)
select o.id, 3, 'active', now(), now() + interval '30 days'
from public.organizations o
where not exists (select 1 from public.license_batches lb where lb.organization_id = o.id);
