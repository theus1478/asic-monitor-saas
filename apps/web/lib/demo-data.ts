export const overview = {
  organization: "Marins Mining",
  licensedMachines: 25,
  activeMachines: 18,
  onlineMachines: 16,
  totalHashrate: "2.41 PH/s",
  estimatedMonthlyUsd: 1436.28,
  nextInvoice: { amount: 69, dueDate: "30 set. 2026", status: "Aguardando pagamento" },
};

export const farms = [
  { name: "Farm principal", city: "São Paulo, SP", agent: "Online", miners: 12, online: 11, hashrate: "1.61 PH/s" },
  { name: "Farm expansão", city: "Campinas, SP", agent: "Online", miners: 6, online: 5, hashrate: "0.80 PH/s" },
];

export const clients = [
  { name: "Marins Mining", email: "matheus@exemplo.com", machines: 25, subscription: "Ativa", renewal: "30 set. 2026" },
  { name: "Hash Norte", email: "operacao@hashnorte.com", machines: 40, subscription: "Em teste", renewal: "14 set. 2026" },
  { name: "Vale ASIC", email: "contato@valeasic.com", machines: 15, subscription: "Pendente", renewal: "12 set. 2026" },
];

export const invoice = {
  id: "INV-2026-09-MARINS",
  amountUsd: 69,
  amountUsdt: 69,
  wallet: "4sYd...uZ8M", // Substituído pelo endereço derivado por fatura no backend.
  expiresAt: "30 set. 2026, 23:59",
};
