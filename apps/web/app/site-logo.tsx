import Image from "next/image";
import Link from "next/link";

export function SiteLogo({ href = "/dashboard", compact = false }: { href?: string; compact?: boolean }) {
  return <Link href={href} className={`site-logo ${compact ? "compact" : ""}`} prefetch>
    <Image src="/favicon.svg" width={compact ? 32 : 40} height={compact ? 32 : 40} alt="" priority />
    <span><strong>ASIC</strong><b>Monitor</b></span>
  </Link>;
}
