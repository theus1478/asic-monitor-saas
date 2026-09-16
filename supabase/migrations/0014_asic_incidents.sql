-- Modulo de Ocorrencias, Alertas e Logs em tempo real.
--
-- Reaproveita o que ja existe: miner_metrics.payload ja carrega o registro
-- normalizado do agente (boards[], uptime_s, temp_c, error...) a cada ciclo,
-- entao nao precisamos de uma tabela de "log bruto" separada - o log bruto e
-- reconstruido em memoria a partir do payload ja armazenado. So persistimos o
-- que e novo: ocorrencias (problema em andamento numa maquina), eventos
-- (linhas de log curadas/importantes, algumas associadas a uma ocorrencia) e
-- o controle de envio de e-mail.

-- ============== CONFIGURACAO DO MOTOR DE REGRAS (por organizacao) ==============
create table public.alert_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  temp_warning_c numeric not null default 85,
  temp_critical_c numeric not null default 95,
  hashrate_attention_pct numeric not null default 90,
  hashrate_warning_pct numeric not null default 75,
  hashrate_critical_pct numeric not null default 50,
  hashrate_window_minutes integer not null default 10,
  offline_after_minutes integer not null default 3,
  email_enabled boolean not null default true,
  email_recipients text[] not null default '{}',
  reminder_cooldown_minutes integer not null default 120,
  disabled_rules text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.alert_settings enable row level security;

create policy "Members can read alert settings of their organization"
  on public.alert_settings for select to authenticated
  using (organization_id in (select organization_id from public.memberships where user_id = (select auth.uid())));

create policy "Members can update alert settings of their organization"
  on public.alert_settings for update to authenticated
  using (organization_id in (select organization_id from public.memberships where user_id = (select auth.uid())))
  with check (organization_id in (select organization_id from public.memberships where user_id = (select auth.uid())));

create policy "Members can create alert settings of their organization"
  on public.alert_settings for insert to authenticated
  with check (organization_id in (select organization_id from public.memberships where user_id = (select auth.uid())));

-- Baseline de hashrate saudavel por maquina (media movel lenta, atualizada so
-- quando a leitura esta saudavel) - usado como "hashrate esperado" sem
-- precisar de um catalogo fixo de TH/s por modelo, que teriamos que inventar.
alter table public.miners add column if not exists baseline_hashrate_ths numeric;

-- ============== OCORRENCIAS ==============
create table public.asic_incidents (
  id uuid primary key default gen_random_uuid(),
  miner_id uuid not null references public.miners(id) on delete cascade,
  farm_id uuid not null references public.farms(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule_key text not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  status text not null default 'active' check (status in ('active', 'resolved', 'acknowledged')),
  title text not null,
  description text not null default '',
  technical_data jsonb not null default '{}'::jsonb,
  detected_value numeric,
  threshold_value numeric,
  occurrence_count integer not null default 1,
  source text not null default 'telemetry',
  email_sent boolean not null default false,
  last_notified_at timestamptz,
  started_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- Uma unica ocorrencia ATIVA por (maquina, regra) - e a base da deduplicacao:
-- o motor faz upsert nessa linha em vez de criar uma nova a cada ciclo.
create unique index asic_incidents_active_unique on public.asic_incidents (miner_id, rule_key) where status = 'active';
create index asic_incidents_miner_id on public.asic_incidents (miner_id);
create index asic_incidents_farm_id on public.asic_incidents (farm_id);
create index asic_incidents_organization_id on public.asic_incidents (organization_id);
create index asic_incidents_status on public.asic_incidents (status);
create index asic_incidents_severity on public.asic_incidents (severity);
create index asic_incidents_created_at on public.asic_incidents (created_at desc);

alter table public.asic_incidents enable row level security;

create policy "Members can read incidents of their organization"
  on public.asic_incidents for select to authenticated
  using (organization_id in (select organization_id from public.memberships where user_id = (select auth.uid())));

create policy "Members can acknowledge incidents of their organization"
  on public.asic_incidents for update to authenticated
  using (organization_id in (select organization_id from public.memberships where user_id = (select auth.uid())))
  with check (organization_id in (select organization_id from public.memberships where user_id = (select auth.uid())));

-- ============== EVENTOS (log curado, correlacionavel com ocorrencias) ==============
create table public.asic_events (
  id bigint generated always as identity primary key,
  miner_id uuid not null references public.miners(id) on delete cascade,
  incident_id uuid references public.asic_incidents(id) on delete set null,
  observed_at timestamptz not null default now(),
  level text not null check (level in ('info', 'warning', 'error', 'critical')),
  category text not null default 'general',
  message text not null,
  data jsonb not null default '{}'::jsonb
);
create index asic_events_miner_id_observed_at on public.asic_events (miner_id, observed_at desc);
create index asic_events_incident_id on public.asic_events (incident_id);

alter table public.asic_events enable row level security;

create policy "Members can read events of their farms"
  on public.asic_events for select to authenticated
  using (miner_id in (select id from public.miners where farm_id in (select id from public.farms where organization_id in (select organization_id from public.memberships where user_id = (select auth.uid())))));

-- ============== CONTROLE DE ENVIO DE E-MAIL ==============
create table public.alert_notifications (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.asic_incidents(id) on delete cascade,
  channel text not null default 'email',
  status text not null check (status in ('sent', 'failed', 'skipped')),
  recipient text,
  error text,
  created_at timestamptz not null default now()
);
create index alert_notifications_incident_id on public.alert_notifications (incident_id);

alter table public.alert_notifications enable row level security;

create policy "Members can read notifications of their organization"
  on public.alert_notifications for select to authenticated
  using (incident_id in (select id from public.asic_incidents where organization_id in (select organization_id from public.memberships where user_id = (select auth.uid()))));

-- Botao "Stop mining" ao lado do reboot - mesma fila de comandos assincronos
-- coletor<->painel ja usada por troca de pool e reinicio.
alter table public.pool_commands drop constraint if exists pool_commands_kind_check;
alter table public.pool_commands add constraint pool_commands_kind_check check (kind in ('pool_update', 'reboot', 'stop_mining'));
