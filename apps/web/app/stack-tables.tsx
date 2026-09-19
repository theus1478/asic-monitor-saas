"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * No celular as tabelas (`.table-wrap`) viram lista de cards (ver mobile.css). Para cada célula
 * mostrar o nome da coluna, copiamos o texto do <th> para `data-label` — assim qualquer tabela
 * do painel funciona sem precisar marcar coluna por coluna.
 */
export function StackTables() {
  const pathname = usePathname();
  useEffect(() => {
    let frame = 0;
    const label = () => {
      document.querySelectorAll<HTMLElement>(".table-wrap").forEach((wrap) => {
        wrap.querySelectorAll("table").forEach((table) => {
          const heads = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent?.trim() ?? "");
          table.querySelectorAll("tbody tr").forEach((row) => {
            Array.from(row.children).forEach((cell, index) => {
              if (heads[index] && !cell.hasAttribute("data-label")) cell.setAttribute("data-label", heads[index]);
            });
          });
        });
        wrap.setAttribute("data-stacked", "");
      });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(label); };
    label();
    // tabelas que aparecem ou ganham linhas depois (router.refresh, filtros)
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [pathname]);
  return null;
}
