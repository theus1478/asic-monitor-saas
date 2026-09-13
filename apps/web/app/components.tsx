import type { ReactNode } from "react";
import { signOut } from "./auth/actions";
import { SidebarNav } from "./sidebar-nav";
import { SiteLogo } from "./site-logo";

export function Shell({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  return <div className="app-shell">
    <aside className="sidebar">
      <SiteLogo />
      <p className="workspace">{admin ? "ADMINISTRAÇÃO" : "PAINEL DA OPERAÇÃO"}</p>
      <SidebarNav admin={admin} />
      <div className="sidebar-bottom"><form action={signOut}><button className="logout-button" type="submit">Sair da conta</button></form><small>v0.2 · Solana USDT</small></div>
    </aside>
    <main className="main">{children}</main>
  </div>;
}

export function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <header className="page-header"><div><p className="page-kicker">ASIC MONITOR CLOUD</p><h1>{title}</h1><p>{description}</p></div>{action}</header>;
}
