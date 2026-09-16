-- Endereço de depósito único por cobrança: em vez de todo mundo pagar pra
-- mesma carteira (e o sistema ter que adivinhar quem foi pelo memo ou por um
-- valor com fração de centavo), cada fatura ganha seu próprio endereço
-- Solana, derivado sob demanda de uma semente mestra (nunca guardado em
-- texto puro). O endereço sozinho já identifica o cliente: não importa se o
-- pagamento veio de uma carteira, de uma exchange ou de uma DEX.

alter table public.invoices add column if not exists deposit_address text;
alter table public.invoices add column if not exists swept_at timestamptz;
alter table public.invoices add column if not exists sweep_signature text;

create index if not exists invoices_deposit_address on public.invoices (deposit_address) where deposit_address is not null;
