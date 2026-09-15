import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function commandKey() {
  const secret = process.env.POOL_COMMAND_SECRET ?? process.env.AGENT_TOKEN_PEPPER;
  if (!secret) throw new Error("POOL_COMMAND_SECRET não configurado no servidor.");
  return createHash("sha256").update(`asic-monitor-pool-command:${secret}`).digest();
}
export function encryptPoolCommand(payload: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", commandKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

export function decryptPoolCommand<T>(encrypted: string): T {
  const packed = Buffer.from(encrypted, "base64url");
  if (packed.length < 29) throw new Error("Comando cifrado inválido.");
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const decipher = createDecipheriv("aes-256-gcm", commandKey(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
