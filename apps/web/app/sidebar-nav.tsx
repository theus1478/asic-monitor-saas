"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const clientLinks = [
  { href: "/dashboard", label: "Visão geral", icon: "⌁" },
  { href: "/farms", label: "Fazendas", icon: "▦" },
  { href: "/collector", label: "Coletor", icon: "⇣" },
  { href: "/billing", label: "Licenças", icon: "◇" },
];

export function SidebarNav({ admin }: { admin: boolean }) {
  const pathname = usePathname();
  return <SidebarNavContent key={pathname} admin={admin} pathname={pathname} />;
}

function SidebarNavContent({ admin, pathname }: { admin: boolean; pathname: string }) {
  const [navigating, setNavigating] = useState(false);
  const links = admin ? [{ href: "/admin", label: "Gestão", icon: "⌁" }] : clientLinks;
  return <>
    <div className={`route-progress ${navigating ? "visible" : ""}`} />
    <nav className="sidebar-nav">{links.map((link) => {
      const active = pathname === link.href || (link.href !== "/dashboard" && pathname.startsWith(`${link.href}/`));
      return <Link key={link.href} href={link.href} prefetch className={active ? "active" : ""} onClick={() => { if (!active) setNavigating(true); }}><span>{link.icon}</span>{link.label}</Link>;
    })}</nav>
  </>;
}
