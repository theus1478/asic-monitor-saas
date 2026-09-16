"use client";

import { useMemo, useState } from "react";
import { cancelCommission, recordPayout, reverseCommission } from "../actions";

type AvailableCommission = { id: string; commission_amount: number; purchase_date: string };

export function PayoutForm({ affiliateId, available }: { affiliateId: string; available: AvailableCommission[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(available.map((c) => c.id)));
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  const total = useMemo(() => available.filter((c) => selected.has(c.id)).reduce((sum, c) => sum + c.commission_amount, 0), [available, selected]);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleSubmit(formData: FormData) {
    setPending(true);
    setFeedback(null);
    for (const id of selected) formData.append("commissionIds", id);
    const result = await recordPayout(affiliateId, formData);
    setFeedback(result);
    setPending(false);
  }

  if (available.length === 0) return <p className="muted">Nenhuma comissão disponível para pagamento no momento.</p>;

  return <form action={handleSubmit} className="inline-form" style={{ flexDirection: "column", alignItems: "stretch", gap: 14 }}>
    <div className="agent-list" style={{ display: "grid", gap: 6 }}>
      {available.map((c) => <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
        USDT {c.commission_amount.toFixed(2)} <span className="muted">— compra de {new Date(c.purchase_date).toLocaleDateString("pt-BR")}</span>
      </label>)}
    </div>
    <p><b>Total selecionado: USDT {total.toFixed(2)}</b></p>
    <input name="paymentMethod" placeholder="Método (ex: Pix, USDT on-chain)" required />
    <input name="paymentReference" placeholder="Referência (opcional)" />
    <input name="notes" placeholder="Observação (opcional)" />
    <button className="button" type="submit" disabled={pending || selected.size === 0}>{pending ? "Registrando..." : "Registrar pagamento"}</button>
    {feedback && <p className={`form-message ${feedback.ok ? "success" : "error"}`}>{feedback.message}</p>}
  </form>;
}

export function CommissionActionButtons({ commissionId, status }: { commissionId: string; status: string }) {
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleCancel() {
    const reason = window.prompt("Motivo do cancelamento (opcional):") ?? "";
    setPending(true);
    setFeedback(await cancelCommission(commissionId, reason));
    setPending(false);
  }
  async function handleReverse() {
    const reason = window.prompt("Motivo da reversão:") ?? "";
    if (!reason.trim()) return;
    setPending(true);
    setFeedback(await reverseCommission(commissionId, reason));
    setPending(false);
  }

  return <div style={{ display: "grid", gap: 4 }}>
    {(status === "pending" || status === "available") && <button className="icon-button danger" type="button" disabled={pending} onClick={handleCancel} title="Cancelar comissão">Cancelar</button>}
    {status === "paid" && <button className="icon-button danger" type="button" disabled={pending} onClick={handleReverse} title="Reverter comissão">Reverter</button>}
    {feedback && <small className={feedback.ok ? "positive" : "warning-text"}>{feedback.message}</small>}
  </div>;
}
