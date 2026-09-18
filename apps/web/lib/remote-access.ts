import { createHmac, randomBytes } from "node:crypto";

// Formato compartilhado com apps/relay/src/token.js: base64url(payload).base64url(hmac-sha256).
// k = "t" (link de uso único, 5 min, emitido aqui) ou "s" (cookie de sessão, 1 h, emitido pelo relay).
export type RemoteLinkPayload = { k: "t"; m: string; o: string; u: string; exp: number; n: string };

const LINK_TTL_SECONDS = 5 * 60;

export function signRemoteLink(input: { minerId: string; organizationId: string; userId: string }) {
  const secret = process.env.REMOTE_ACCESS_SECRET;
  if (!secret) throw new Error("Acesso remoto não configurado no servidor (REMOTE_ACCESS_SECRET).");
  const payload: RemoteLinkPayload = { k: "t", m: input.minerId, o: input.organizationId, u: input.userId, exp: Math.floor(Date.now() / 1000) + LINK_TTL_SECONDS, n: randomBytes(12).toString("base64url") };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

/** Endereço público da máquina: um subdomínio por máquina, porque a tela da ASIC usa caminhos absolutos. */
export function remoteMachineUrl(minerId: string, token: string) {
  const domain = process.env.REMOTE_BASE_DOMAIN || "remote.monitorasic.club";
  return `https://m-${minerId}.${domain}/?t=${encodeURIComponent(token)}`;
}
