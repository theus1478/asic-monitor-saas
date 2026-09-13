-- O agente agora busca sua lista de máquinas na nuvem (endpoint /api/agent/config)
-- em vez de depender só do config.json local. Para isso a API precisa saber o
-- fabricante de cada máquina, já que o parsing varia por vendor.

alter table public.miners
  add column if not exists type text not null default 'antminer'
    check (type in ('antminer', 'whatsminer', 'avalon'));
