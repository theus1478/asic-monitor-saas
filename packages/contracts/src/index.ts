export type MinerKind = "antminer" | "whatsminer" | "avalon";

export interface MinerRegistration {
  id: string;
  name: string;
  ip: string;
  port: number;
  kind: MinerKind;
  enabled: boolean;
}

export interface MinerMetric {
  minerId: string;
  observedAt: string;
  online: boolean;
  hashrateThs?: number;
  powerWatts?: number;
  efficiencyJth?: number;
  temperatureC?: number;
  fanRpm?: number;
  rejectedShares?: number;
  uptimeSeconds?: number;
  error?: string;
}

export interface MetricBatch {
  farmId: string;
  agentId: string;
  metrics: MinerMetric[];
}
