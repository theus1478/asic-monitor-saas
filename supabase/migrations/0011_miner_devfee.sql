-- Devfee individual por maquina: em vez de assumir uma taxa fixa pra todo
-- fabricante (o que era falso - devfee depende do firmware instalado, nao do
-- fabricante do hardware), cada maquina guarda seu proprio percentual.
-- Sem valor definido (null) = nao descontar nada, porque provavelmente esta
-- em firmware original sem devfee.

alter table public.miners
  add column if not exists devfee_pct numeric(5, 2)
    check (devfee_pct is null or (devfee_pct >= 0 and devfee_pct <= 100));
