import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_CENTERS } from "./datacenters.js";
import { OpenMeteoProvider } from "./weather/openMeteo.js";
import { SimulatedExecutor } from "./actions/simulated.js";
import { scoreDataCenter, LITERS_PER_GALLON } from "./wsi.js";
import { seedJobs, usedCapacity } from "./queue.js";
import { thermalScout, shiftPlanner, waterBroker } from "./agents.js";
import type { AuditEvent, Job, ShiftPlan, StressReading, WeatherForecast } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4177);
const TICK_MS = 5_000;
const WEATHER_REFRESH_MS = 10 * 60_000;

// swap these two lines for JuaProvider / RenderExecutor when keys arrive
const weather = new OpenMeteoProvider();
const executor = new SimulatedExecutor();

// ---------- state ----------
const jobs: Job[] = seedJobs(DATA_CENTERS.map((d) => d.id));
const forecasts = new Map<string, WeatherForecast>();
const heatwave = new Map<string, number>(); // dcId -> °C offset (demo override)
let readings: StressReading[] = [];
let auditLog: AuditEvent[] = [];
let recentPlans: ShiftPlan[] = [];
let litersSaved = 0;
let lastTickAt = Date.now();
let agentBusy = false;
let lastLevelsKey = "";
const capacityBoost = new Map<string, number>(); // dcId -> extra units from scale-ups

async function refreshWeather() {
  await Promise.all(
    DATA_CENTERS.map(async (dc) => {
      try {
        forecasts.set(dc.id, await weather.getForecast(dc));
      } catch (err) {
        console.error(`weather fetch failed for ${dc.id}:`, err);
      }
    }),
  );
}

function score(): StressReading[] {
  return DATA_CENTERS.flatMap((dc) => {
    const fc = forecasts.get(dc.id);
    if (!fc) return [];
    const offset = heatwave.get(dc.id) ?? 0;
    const adjusted: WeatherForecast = {
      ...fc,
      hours: fc.hours.map((h, i) => ({
        ...h,
        // heatwave ramps: +offset now, building slightly over the forecast window
        tempC: h.tempC + offset * (1 + i * 0.08),
        humidityPct: offset > 0 ? Math.max(8, h.humidityPct - offset * 1.5) : h.humidityPct,
      })),
    };
    return [scoreDataCenter(dc, adjusted)];
  });
}

const wueOf = (dcId: string) => readings.find((r) => r.dcId === dcId)?.wue ?? 0;

function accrueSavings(dtMs: number) {
  // honest accounting: only jobs AquaShift moved, at the live WUE delta
  for (const j of jobs) {
    if (j.dcId !== j.homeDcId && j.status === "running") {
      const delta = wueOf(j.homeDcId) - wueOf(j.dcId);
      if (delta > 0) litersSaved += j.kwhPerHour * delta * (dtMs / 3_600_000);
    }
  }
}

async function runAgents() {
  if (agentBusy) return;
  agentBusy = true;
  try {
    const scout = thermalScout(readings);
    let events = scout.events;
    if (scout.stressed.length > 0) {
      const planner = shiftPlanner(jobs, scout.stressed, scout.coolest, readings);
      events = events.concat(planner.events);
      if (planner.plans.length > 0) {
        recentPlans = planner.plans.concat(recentPlans).slice(0, 10);
        const broker = await waterBroker(planner.plans, jobs, executor);
        events = events.concat(broker.events);
        for (const [dcId, units] of broker.scaleUps) {
          capacityBoost.set(dcId, (capacityBoost.get(dcId) ?? 0) + units);
        }
      }
    }
    // log only on state changes or executed actions — not every tick
    const levelsKey = readings.map((r) => `${r.dcId}:${r.level}`).join(",");
    const acted = events.some((e) => e.agent !== "thermal-scout");
    if (acted || levelsKey !== lastLevelsKey) {
      auditLog = events.concat(auditLog).slice(0, 60);
    }
    lastLevelsKey = levelsKey;
  } finally {
    agentBusy = false;
  }
}

async function tick() {
  readings = score();
  const dtMs = Date.now() - lastTickAt;
  lastTickAt = Date.now();
  accrueSavings(dtMs);
  await runAgents();
  broadcast();
}

// ---------- SSE ----------
const clients = new Set<express.Response>();

function snapshot() {
  return {
    time: new Date().toISOString(),
    weatherSource: weather.name,
    executor: executor.name,
    dataCenters: DATA_CENTERS.map((dc) => ({
      ...dc,
      capacity: dc.capacity + (capacityBoost.get(dc.id) ?? 0),
      used: usedCapacity(jobs, dc.id),
      heatwave: (heatwave.get(dc.id) ?? 0) > 0,
      reading: readings.find((r) => r.dcId === dc.id) ?? null,
    })),
    jobs,
    recentPlans,
    audit: auditLog.slice(0, 25),
    litersSaved: Math.round(litersSaved * 10) / 10,
    gallonsSaved: Math.round((litersSaved / LITERS_PER_GALLON) * 10) / 10,
  };
}

function broadcast() {
  const payload = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const res of clients) res.write(payload);
}

// ---------- http ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

app.get("/api/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no"); // keep proxies from buffering the stream
  res.flushHeaders();
  res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
  clients.add(res);
  req.on("close", () => clients.delete(res));
});

app.get("/api/state", (_req, res) => res.json(snapshot()));

// demo controls
app.post("/api/demo/heatwave", async (req, res) => {
  const dcId = (req.body?.dcId as string) ?? "us-phoenix";
  heatwave.set(dcId, 12); // +12°C spike, humidity drops — pushes WUE past critical
  await tick();
  res.json({ ok: true, dcId });
});

app.post("/api/demo/reset", async (_req, res) => {
  heatwave.clear();
  for (const j of jobs) {
    j.dcId = j.homeDcId;
    j.status = "running";
  }
  litersSaved = 0;
  recentPlans = [];
  auditLog = [];
  capacityBoost.clear();
  lastLevelsKey = "";
  await tick();
  res.json({ ok: true });
});

// ---------- boot ----------
await refreshWeather();
readings = score();
setInterval(refreshWeather, WEATHER_REFRESH_MS);
setInterval(tick, TICK_MS);

app.listen(PORT, () => {
  console.log(`💧 AquaShift running → http://localhost:${PORT}`);
  console.log(`   weather: ${weather.name} | actions: ${executor.name}`);
});
