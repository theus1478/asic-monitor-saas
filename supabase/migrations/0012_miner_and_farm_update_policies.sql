-- RLS tinha select/insert/delete pra miners e farms, mas nenhuma policy de
-- update - qualquer UPDATE de um usuario autenticado (ex.: salvar o devfee de
-- uma maquina, renomear uma fazenda) era silenciosamente bloqueado pelo RLS
-- (0 linhas afetadas, sem erro), entao a UI mostrava "salvo" mas nada mudava.

create policy "Members can update miners of their farms"
  on public.miners for update
  to authenticated
  using (farm_id in (select id from public.farms where organization_id in (select organization_id from public.memberships where user_id = (select auth.uid()))))
  with check (farm_id in (select id from public.farms where organization_id in (select organization_id from public.memberships where user_id = (select auth.uid()))));

create policy "Members can update farms in their organization"
  on public.farms for update
  to authenticated
  using (organization_id in (select organization_id from public.memberships where user_id = (select auth.uid())))
  with check (organization_id in (select organization_id from public.memberships where user_id = (select auth.uid())));
