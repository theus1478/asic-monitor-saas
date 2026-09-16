"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

export function SidebarNav({ admin }: { admin: boolean }) {
  const pathname = usePathname();
  return <SidebarNavContent key={pathname} admin={admin} pathname={pathname} />;
}

function SidebarNavContent({ admin, pathname }: { admin: boolean; pathname: string }) {
  const t = useTranslations("nav");
  const [navigating, setNavigating] = useState(false);
  const clientLinks = [
    { href: "/dashboard", label: t("overview"), icon: "⌁" },
    { href: "/farms", label: t("farms"), icon: "▦" },
    { href: "/collector", label: t("collector"), icon: "⇣" },
    { href: "/incidents", label: t("incidents"), icon: "▲" },
    { href: "/billing", label: t("licenses"), icon: "◇" },
    { href: "/affiliate", label: t("affiliates"), icon: "✦" },
  ];
  const links = admin ? [{ href: "/admin", label: t("management"), icon: "⌁" }, { href: "/admin/affiliates", label: t("affiliates"), icon: "✦" }] : clientLinks;
  return <>
    <div className={`route-progress ${navigating ? "visible" : ""}`} />
    <nav className="sidebar-nav">{links.map((link) => {
      const active = pathname === link.href || (link.href !== "/dashboard" && pathname.startsWith(`${link.href}/`));
      return <Link key={link.href} href={link.href} prefetch className={active ? "active" : ""} onClick={() => { if (!active) setNavigating(true); }}><span>{link.icon}</span>{link.label}</Link>;
    })}</nav>
  </>;
}
