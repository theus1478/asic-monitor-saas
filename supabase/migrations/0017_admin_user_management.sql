-- Fundação da Gestão de Usuários no Admin Center: dois níveis de admin de
-- plataforma (substituindo o booleano único platform_admin), campos de
-- perfil/status usados pelo painel, e o log de auditoria administrativo
-- (mesmo padrão já usado por affiliate_audit_log em 0009).

create type public.platform_role as enum ('super_admin', 'admin');

alter table public.profiles
  add column username text unique,
  add column platform_role public.platform_role,
  add column phone text,
  add column company text,
  add column job_title text,
  add column timezone text,
  add column country text,
  add column locale text,
  add column account_status text not null default 'active'
    check (account_status in ('active', 'inactive', 'suspended', 'blocked')),
  add column status_reason text,
  add column status_changed_at timestamptz,
  add column status_changed_by uuid references public.profiles(id),
  add column admin_notes text;

-- Backfill: quem já era platform_admin=true vira super_admin — não havia
-- níveis antes desta migration, então ninguém perde acesso.
update public.profiles set platform_role = 'super_admin' where platform_admin = true;

-- platform_admin passa a ser derivado de platform_role (não editado direto
-- por código novo) — mantém requirePlatformAdmin()/isPlatformAdmin() e o
-- middleware existentes funcionando sem nenhuma alteração, já que os dois
-- só leem essa coluna.
create or replace function public.sync_platform_admin()
returns trigger
language plpgsql
as $$
begin
  new.platform_admin := (new.platform_role is not null);
  return new;
end;
$$;

drop trigger if exists profiles_sync_platform_admin on public.profiles;
create trigger profiles_sync_platform_admin
  before insert or update of platform_role on public.profiles
  for each row execute function public.sync_platform_admin();

create table public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.profiles(id),
  target_user_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null default 'user',
  entity_id uuid,
  old_data jsonb,
  new_data jsonb,
  reason text,
  ip_address text,
  created_at timestamptz not null default now()
);
create index admin_audit_logs_target on public.admin_audit_logs (target_user_id, created_at desc);
create index admin_audit_logs_recent on public.admin_audit_logs (created_at desc);
alter table public.admin_audit_logs enable row level security;
-- Sem policy de leitura via anon/authenticated — só acessado com a service
-- role a partir do Admin Center, mesmo padrão de affiliate_audit_log.
