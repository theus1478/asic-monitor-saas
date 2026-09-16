-- "Reconhecer" uma ocorrencia nao pode equivaler a resolve-la (pedido
-- explicito): o motor de regras precisa continuar atualizando/resolvendo
-- normalmente uma ocorrencia mesmo depois de reconhecida. O indice unico
-- original so cobria status='active', entao uma ocorrencia reconhecida
-- ficava fora da deduplicacao e um ciclo poderia criar uma segunda linha
-- para o mesmo (maquina, regra) - corrige pra cobrir os dois estados "em
-- aberto".
drop index if exists public.asic_incidents_active_unique;
create unique index asic_incidents_active_unique on public.asic_incidents (miner_id, rule_key) where status in ('active', 'acknowledged');
