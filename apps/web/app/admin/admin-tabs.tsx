import Link from "next/link";

/** Abas do painel único de Gestão: visão por organização (Clientes) e por conta (Usuários). */
export function AdminTabs({ active }: { active: "clients" | "users" }) {
  return <nav className="tabs" style={{ marginBottom: 20 }}>
    <Link href="/admin" className={active === "clients" ? "active" : ""}>Clientes</Link>
    <Link href="/admin/users" className={active === "users" ? "active" : ""}>Usuários</Link>
  </nav>;
}
