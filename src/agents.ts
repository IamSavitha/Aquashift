import { dcById } from "./datacenters.js";
import { LITERS_PER_GALLON } from "./wsi.js";
import type { ActionExecutor, AuditEvent, Job, ShiftPlan, StressReading } from "./types.js";

/**
 * The three-agent pipeline. Each agent is a plain async function today; the
 * orchestrate() wrapper is where Guild.ai governance (identity, budget caps,
 * kill switch) wraps each call once a key is available — the agent bodies
 * don't change.
 */

let auditId = 1;
const audit = (
  agent: string,
  action: string,
  detail: string,
  status: AuditEvent["status"] = "ok",
): AuditEvent => ({
  id: auditId++,
  time: new Date().toISOString(),
  agent,
  action,
  detail,
  status,
  costUsd: 0.003, // per-agent-call budget placeholder, enforced by Guild later
});

/** Thermal Scout: rank locations by water cost per compute unit, flag risk. */
export function thermalScout(readings: StressReading[]): {
  ranked: StressReading[];
  stressed: StressReading[];
  coolest: StressReading;
  events: AuditEvent[];
} {
  const ranked = [...readings].sort((a, b) => b.wsi - a.wsi);
  const stressed = ranked.filter((r) => r.level === "warning" || r.level === "critical");
  const coolest = ranked[ranked.length - 1];
  const events = [
    audit(
      "thermal-scout",
      "rank-locations",
      ranked
        .map((r) => `${r.dcId}: WSI ${r.wsi} (WUE ${r.wue} L/kWh, wet-bulb ${r.wetBulbC}°C)`)
        .join(" | "),
    ),
  ];
  for (const s of stressed) {
    events.push(
      audit(
        "thermal-scout",
        "stress-alert",
        `${s.dcId} at ${s.level.toUpperCase()} — WUE ${s.wue} L/kWh now, peak ${s.peakForecastWue} L/kWh within 6h`,
      ),
    );
  }
  return { ranked, stressed, coolest, events };
}

/** Shift Planner: pick shiftable jobs in stressed DCs, target the coolest DC. */
export function shiftPlanner(
  jobs: Job[],
  stressed: StressReading[],
  coolest: StressReading,
  readings: StressReading[],
): { plans: ShiftPlan[]; events: AuditEvent[] } {
  const plans: ShiftPlan[] = [];
  const events: AuditEvent[] = [];
  const wueOf = (dcId: string) => readings.find((r) => r.dcId === dcId)!.wue;

  for (const hot of stressed) {
    if (hot.dcId === coolest.dcId) continue;
    const wueDelta = wueOf(hot.dcId) - wueOf(coolest.dcId);
    if (wueDelta <= 0.3) {
      events.push(
        audit(
          "shift-planner",
          "no-shift",
          `${hot.dcId}: WUE delta to ${coolest.dcId} only ${wueDelta.toFixed(2)} L/kWh — not worth migration cost`,
          "skipped",
        ),
      );
      continue;
    }

    const shiftable = jobs.filter(
      (j) => j.dcId === hot.dcId && !j.latencySensitive && j.status === "running",
    );
    const fixed = jobs.filter((j) => j.dcId === hot.dcId && j.latencySensitive).length;
    if (shiftable.length === 0) continue;

    const kwhPerHourShifted = shiftable.reduce((s, j) => s + j.kwhPerHour, 0);
    const litersSavedPerHour = kwhPerHourShifted * wueDelta;

    plans.push({
      fromDcId: hot.dcId,
      toDcId: coolest.dcId,
      jobs: shiftable,
      kwhPerHourShifted: Math.round(kwhPerHourShifted * 10) / 10,
      wueDelta: Math.round(wueDelta * 100) / 100,
      litersSavedPerHour: Math.round(litersSavedPerHour),
      gallonsSavedPerHour: Math.round(litersSavedPerHour / LITERS_PER_GALLON),
      reason: `${hot.dcId} ${hot.level} (WSI ${hot.wsi}); ${coolest.dcId} coolest (WSI ${coolest.wsi})`,
    });
    events.push(
      audit(
        "shift-planner",
        "plan-shift",
        `${shiftable.length} shiftable jobs (${fixed} latency-sensitive stay) ${hot.dcId} → ${coolest.dcId}: ` +
          `${Math.round(kwhPerHourShifted)} kWh/h × ${wueDelta.toFixed(2)} L/kWh = ${Math.round(litersSavedPerHour)} L/h saved`,
      ),
    );
  }
  return { plans, events };
}

/** Water Broker: execute the plans via the action layer, mutate job state. */
export async function waterBroker(
  plans: ShiftPlan[],
  jobs: Job[],
  executor: ActionExecutor,
): Promise<{ events: AuditEvent[]; scaleUps: Map<string, number> }> {
  const events: AuditEvent[] = [];
  const scaleUps = new Map<string, number>();
  for (const plan of plans) {
    const from = dcById(plan.fromDcId);
    const to = dcById(plan.toDcId);
    const units = plan.jobs.reduce((s, j) => s + j.computeUnits, 0);

    events.push(audit("water-broker", "scale-up", await executor.scaleUp(to, units)));
    scaleUps.set(to.id, (scaleUps.get(to.id) ?? 0) + units);
    events.push(audit("water-broker", "pause-queue", await executor.pauseQueue(from)));

    for (const job of plan.jobs) {
      const j = jobs.find((x) => x.id === job.id)!;
      j.dcId = plan.toDcId;
      j.status = "running";
    }
    events.push(
      audit(
        "water-broker",
        "migrate-jobs",
        `${plan.jobs.length} jobs live in ${to.name} — saving ${plan.gallonsSavedPerHour} gal/h`,
      ),
    );
    events.push(
      audit(
        "water-broker",
        "notify",
        await executor.notify(
          `AquaShift moved ${plan.jobs.length} jobs ${from.name} → ${to.name}, saving ~${plan.gallonsSavedPerHour} gal/h. Reason: ${plan.reason}`,
        ),
      ),
    );
  }
  return { events, scaleUps };
}
