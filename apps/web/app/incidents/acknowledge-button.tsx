"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { acknowledgeIncident } from "./actions";

export function AcknowledgeButton({ incidentId, label, pendingLabel }: { incidentId: string; label: string; pendingLabel: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const run = async () => {
    setPending(true);
    const result = await acknowledgeIncident(incidentId);
    setPending(false);
    if (!result.ok) setMessage(result.message);
    else router.refresh();
  };
  return <>
    <button className="button secondary compact" type="button" disabled={pending} onClick={run}>{pending ? pendingLabel : label}</button>
    {message && <small style={{ display: "block", color: "var(--danger)" }}>{message}</small>}
  </>;
}
