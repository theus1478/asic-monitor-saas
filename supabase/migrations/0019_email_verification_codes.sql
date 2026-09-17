-- Confirmação de e-mail por código de 6 dígitos (cadastro e troca de e-mail).
-- auth.users.email_confirmed_at continua sendo a única fonte de verdade pra
-- "e-mail confirmado" em todo o sistema - esta tabela só guarda o mecanismo
-- de entrega/validação do código, nunca um segundo estado de confirmação.

create type public.otp_purpose as enum ('email_verification', 'email_change');

create table public.email_verification_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  purpose public.otp_purpose not null,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);
create index email_verification_codes_active on public.email_verification_codes (user_id, purpose, created_at desc);
alter table public.email_verification_codes enable row level security;
-- Sem policy de leitura via anon/authenticated - só acessado com a service
-- role (lib/otp.ts), mesmo padrão de admin_audit_logs.

-- Guarda o novo endereço durante uma troca de e-mail com confirmação
-- pendente. auth.users.email só é atualizado quando o código é confirmado,
-- pra nunca travar o usuário fora da própria conta.
alter table public.profiles add column pending_email text;
