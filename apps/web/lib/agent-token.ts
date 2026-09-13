import { createHash, randomBytes } from "node:crypto";

export function generateAgentToken() {
  return randomBytes(32).toString("base64url");
}

/** Hash com pepper do servidor — o token em texto puro nunca é salvo. */
export function hashAgentToken(token: string) {
  const pepper = process.env.AGENT_TOKEN_PEPPER ?? "";
  return createHash("sha256").update(`${token}${pepper}`).digest("hex");
}
