import { createRelay } from "./relay.js";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) { console.error(`Variável de ambiente ${name} não configurada.`); process.exit(1); }
  return value;
}

const relay = createRelay({
  supabaseUrl: requireEnv("SUPABASE_URL").replace(/\/$/, ""),
  serviceKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  pepper: process.env.AGENT_TOKEN_PEPPER ?? "",
  secret: requireEnv("REMOTE_ACCESS_SECRET"),
  baseDomain: (process.env.REMOTE_BASE_DOMAIN || "remote.monitorasic.club").toLowerCase(),
});

const port = Number(process.env.PORT) || 8080;
relay.server.listen(port, "0.0.0.0", () => console.log(`relay escutando em 0.0.0.0:${port}`));

for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { relay.close().then(() => process.exit(0)); });
