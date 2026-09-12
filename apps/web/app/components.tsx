import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "./auth/actions";

export function Shell({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  return <div className="app-shell">
    <aside className="sidebar">
      <Link href="/dashboard" className="brand"><span className="brand-mark">A</span><span>ASIC <b>Monitor</b></span></Link>
      <p className="workspace">{admin ? "ADMINISTRAÇÃO" : "MARINS MINING"}</p>
      <nav>
        {admin ? <>
          <Link href="/admin">Visão geral</Link><a href="#clientes">Clientes</a><a href="#licencas">Licenças</a>
        </> : <>
          <Link href="/dashboard">Visão geral</Link><Link href="/farms">Fazendas e máquinas</Link><Link href="/billing">Assinatura e cobrança</Link>
        </>}
      </nav>
      <div className="sidebar-bottom"><form action={signOut}><button className="logout-button" type="submit">Sair</button></form><small>v0.1 · Solana USDT</small></div>
    </aside>
    <main className="main">{children}</main>
  </div>;
}

export function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <header className="page-header"><div><h1>{title}</h1><p>{description}</p></div>{action}</header>;
}
