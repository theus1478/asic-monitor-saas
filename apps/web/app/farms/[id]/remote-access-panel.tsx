"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RemoteToggleResult } from "./remote-access";

export function RemoteAccessPanel({ enabled, canManage, setEnabled }: { enabled: boolean; canManage: boolean; setEnabled: (enabled: boolean) => Promise<RemoteToggleResult> }) {
  const t = useTranslations("farmDetail");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<RemoteToggleResult | null>(null);
  const toggle = () => startTransition(async () => {
    const next = !enabled;
    if (next && !window.confirm(t("remoteEnableConfirm"))) return;
    setFeedback(await setEnabled(next));
    router.refresh();
  });
  return <div className="lm-remote-panel">
    <div className="lm-remote-head">
      <div><h3>{t("remoteTitle")}</h3><p>{t("remoteBody")}</p></div>
      <button type="button" className={`lm-btn ${enabled ? "lm-danger" : "lm-hl-solid"}`} disabled={pending || !canManage} onClick={toggle}>{enabled ? t("remoteDisable") : t("remoteEnable")}</button>
    </div>
    <p className="lm-remote-state">{enabled ? t("remoteStateOn") : t("remoteStateOff")}{!canManage && ` · ${t("remoteNoPermission")}`}</p>
    {feedback && <p className={feedback.ok ? "lm-ok" : "lm-err"} role="status">{feedback.message}</p>}
    <p className="lm-remote-warning">{t("remotePasswordWarning")}</p>
  </div>;
}
