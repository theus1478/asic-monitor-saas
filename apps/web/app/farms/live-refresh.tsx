"use client";

import { useCallback, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

const REFRESH_INTERVAL_MS = 15_000;

export function LiveRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, REFRESH_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [refresh]);

  return <button className="button secondary live-refresh" type="button" onClick={refresh} disabled={pending}>
    <span className={`live-pulse ${pending ? "updating" : ""}`} />
    {pending ? "Atualizando..." : "Ao vivo · 15s"}
  </button>;
}
