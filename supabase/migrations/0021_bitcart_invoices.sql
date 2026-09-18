-- Cobrança via BitCart (USDT-BEP20): cada fatura passa a apontar para a
-- invoice correspondente no BitCart. As colunas do fluxo Solana antigo
-- (wallet_address, deposit_address, network, swept_at, sweep_signature)
-- continuam existindo só como histórico; wallet_address agora guarda o
-- endereço de pagamento devolvido pelo BitCart.

alter table public.invoices add column if not exists bitcart_invoice_id text;

create unique index if not exists invoices_bitcart_invoice_id
  on public.invoices (bitcart_invoice_id) where bitcart_invoice_id is not null;
