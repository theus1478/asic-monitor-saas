import { PageHeader, Shell } from "../components";
import { getOrganizationId } from "../../lib/org-data";
import { BillingCalculator } from "./billing-calculator";

export default async function BillingPage() {
  const { supabase, organizationId } = await getOrganizationId();

  const { data: farms } = organizationId
    ? await supabase.from("farms").select("id").eq("organization_id", organizationId)
    : { data: [] as { id: string }[] };
  const farmIds = (farms ?? []).map((f) => f.id);

  const { count } = farmIds.length
    ? await supabase.from("miners").select("id", { count: "exact", head: true }).in("farm_id", farmIds)
    : { count: 0 };

  return <Shell>
    <PageHeader title="Assinatura e cobrança" description="Informe quantas máquinas você precisa monitorar para calcular o valor da fatura em USDT." />
    <BillingCalculator initialMachineCount={count ?? 0} />
    <section className="card"><h2>Como a licença funciona</h2><div className="three-columns"><p><b>Preço por faixa</b><br />Quanto mais máquinas, menor o custo médio por unidade.</p><p><b>Desconto a partir de 15</b><br />As faixas progressivas são configuráveis pelo administrador.</p><p><b>Confirmação automática</b><br />A plataforma valida o pagamento na blockchain Solana.</p></div></section>
  </Shell>;
}
