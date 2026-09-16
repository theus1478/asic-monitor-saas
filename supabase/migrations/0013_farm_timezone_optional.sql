-- O campo de fuso horario tinha um valor mocado (America/Sao_Paulo) como
-- default obrigatorio - a fazenda nunca ficava de fato sem timezone, mesmo
-- quando o cliente nao informava nenhum. Agora o campo e realmente opcional.

alter table public.farms alter column timezone drop default;
alter table public.farms alter column timezone drop not null;
