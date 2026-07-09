export interface DataCenter {
  id: string;
  name: string;
  region: string;
  lat: number;
  lon: number;
  coolingType: "evaporative" | "air" | "hybrid";
  /** 0–1 long-term regional water scarcity (WRI Aqueduct-style baseline) */
  droughtFactor: number;
  /** gCO2/kWh grid carbon intensity (static baseline for MVP) */
  gridCarbon: number;
  /** total GPU capacity in arbitrary compute units */
  capacity: number;
}

export interface HourlyWeather {
  time: string; // ISO
  tempC: number;
  humidityPct: number;
  windKph: number;
}

export interface WeatherForecast {
  dcId: string;
  fetchedAt: string;
  source: string;
  hours: HourlyWeather[]; // next 6 hours
}

export interface WeatherProvider {
  name: string;
  getForecast(dc: DataCenter): Promise<WeatherForecast>;
}

export interface StressReading {
  dcId: string;
  time: string;
  tempC: number;
  humidityPct: number;
  wetBulbC: number;
  /** Water Usage Effectiveness, liters per kWh of IT load */
  wue: number;
  /** 0–10 composite Water Stress Index */
  wsi: number;
  level: "normal" | "elevated" | "warning" | "critical";
  /** WUE for each of the next 6 forecast hours */
  forecastWue: number[];
  peakForecastWue: number;
}

export type JobType = "batch-training" | "batch-inference" | "realtime-api";

export interface Job {
  id: string;
  name: string;
  type: JobType;
  /** compute units consumed while running */
  computeUnits: number;
  /** estimated energy per hour, kWh */
  kwhPerHour: number;
  latencySensitive: boolean;
  status: "running" | "queued" | "paused" | "migrating";
  dcId: string;
  homeDcId: string; // where it was originally placed
}

export interface ShiftPlan {
  fromDcId: string;
  toDcId: string;
  jobs: Job[];
  kwhPerHourShifted: number;
  wueDelta: number; // L/kWh saved per shifted kWh
  litersSavedPerHour: number;
  gallonsSavedPerHour: number;
  reason: string;
}

export interface AuditEvent {
  id: number;
  time: string;
  agent: string;
  action: string;
  detail: string;
  status: "ok" | "skipped" | "error";
  costUsd: number;
}

export interface ActionExecutor {
  name: string;
  scaleUp(dc: DataCenter, units: number): Promise<string>;
  pauseQueue(dc: DataCenter): Promise<string>;
  resumeQueue(dc: DataCenter): Promise<string>;
  notify(message: string): Promise<string>;
}
