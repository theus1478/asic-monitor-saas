/**
 * Camada normalizada sobre o payload que o coletor ja envia (mesmo formato do
 * `_base_record` em apps/agent/src/miners.py, gravado em miner_metrics.payload).
 * O motor de regras trabalha só sobre este formato — nunca lê um campo
 * específico de fabricante diretamente, então um firmware/vendor novo só
 * precisa alimentar isto corretamente para os alertas funcionarem.
 */

export type NormalizedBoard = {
  index: number;
  name: string;
  hashrateThs: number | null;
  chipTempC: number | null;
  pcbTempC: number | null;
};

export type NormalizedMinerStatus = {
  online: boolean;
  hashrateThs: number | null;
  uptimeSeconds: number | null;
  temperatureC: number | null;
  boards: NormalizedBoard[];
  fansRpm: number[];
  coolingMode: string | null;
  error: string | null;
};

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeMinerPayload(
  payload: Record<string, unknown> | null | undefined,
  fallback: { online: boolean; hashrateThs: number | null; temperatureC: number | null },
): NormalizedMinerStatus {
  const p = payload ?? {};
  const rawBoards = Array.isArray(p.boards) ? p.boards : [];
  const boards: NormalizedBoard[] = rawBoards.map((board, index) => {
    const b = (board ?? {}) as Record<string, unknown>;
    return {
      index,
      name: typeof b.name === "string" && b.name ? b.name : `#${index + 1}`,
      hashrateThs: toNumber(b.hashrate_ths),
      chipTempC: toNumber(b.chip_temp_c),
      pcbTempC: toNumber(b.pcb_temp_c),
    };
  });
  const fansRpm = Array.isArray(p.fans_rpm) ? p.fans_rpm.filter((v): v is number => typeof v === "number") : [];

  return {
    online: typeof p.online === "boolean" ? p.online : fallback.online,
    hashrateThs: toNumber(p.hashrate_ths) ?? fallback.hashrateThs,
    uptimeSeconds: toNumber(p.uptime_s),
    temperatureC: toNumber(p.temp_c) ?? fallback.temperatureC,
    boards,
    fansRpm,
    coolingMode: typeof p.cooling_mode === "string" ? p.cooling_mode : null,
    error: typeof p.error === "string" ? p.error : null,
  };
}
