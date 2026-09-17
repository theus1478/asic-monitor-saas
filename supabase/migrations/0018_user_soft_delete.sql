-- Exclusão de usuário no Admin Center (soft delete): marca a conta como
-- excluída em vez de apagar dados de verdade, evitando registros órfãos em
-- organizations/farms/miners (que não têm um caminho de exclusão em cascata
-- a partir de profiles). A restrição a super_admin é aplicada em código
-- (requireSuperAdmin), igual ao resto das ações sensíveis já implementadas.

alter table public.profiles
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.profiles(id);
