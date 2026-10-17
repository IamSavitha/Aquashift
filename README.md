# 💧 AquaShift

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=white)

**The weather-aware workload intelligence layer for data centers.** AquaShift watches hyperlocal weather at every data center, computes a live Water Stress Index, and autonomously shifts batch compute away from water-stressed regions — then proves the savings in gallons, live.

**Live demo:** [aquashift.onrender.com](https://aquashift.onrender.com) (free tier, so the first load can take about 30 s while it wakes up)

## Quickstart

```bash
npm install
npm run dev
# → http://localhost:4177
```

No API keys required. Weather is live from Open-Meteo (free, keyless). All infra actions run through a simulated executor with the same interface as the real ones.

## The 60-second demo

1. Open the dashboard. The three data centers (Phoenix, Ashburn, Dublin) are scored on **real, current weather**. On a hot Arizona afternoon Phoenix often goes critical on its own.
2. Hit **⚡ Trigger Phoenix Heatwave** — simulates a +12°C spike (the Jua forecast scenario).
3. Watch the cascade in the agent audit trail:
   - `thermal-scout` flags Phoenix critical, ranks all regions by Water Stress Index
   - `shift-planner` picks the shiftable jobs (batch training/inference) and shows its math: kWh/h × ΔWUE = liters/hour saved. Latency-sensitive jobs stay put.
   - `water-broker` scales up Dublin capacity, pauses the Phoenix batch queue, migrates the jobs, fires the ops notification
4. The **gallons-saved counter** ticks up in real time — honest accounting, computed every tick from the live WUE delta of jobs AquaShift actually moved.
5. **Reset Simulation** returns everything home for the next run.

## How the math works

- **Wet-bulb temperature** — Stull (2011) approximation from temp + relative humidity. Wet-bulb is the physical limit on evaporative cooling efficiency.
- **WUE (L/kWh)** — modeled as ~0.16 L/kWh per °C of wet-bulb above the 7°C free-cooling threshold, with multipliers for cooling type (evaporative 1.25× / hybrid 1.0× / air 0.7×) and extreme dry-bulb heat. Calibrated to the ~1.8 L/kWh industry average and 3.5+ L/kWh hot-desert evaporative sites.
- **Water Stress Index (0–10)** — 50% live WUE, 30% regional drought factor, 20% grid carbon intensity.
- **Savings** — `kWh/h shifted × (WUE_origin − WUE_destination)`, accrued per tick only for jobs AquaShift moved, at the current live delta.

## Architecture

```
src/
  wsi.ts                 wet-bulb / WUE / Water Stress Index math
  weather/openMeteo.ts   live weather, no key        ┐ WeatherProvider
  weather/jua.ts         Jua adapter (stub)          ┘ interface
  agents.ts              thermal-scout → shift-planner → water-broker
  actions/simulated.ts   demo executor               ┐ ActionExecutor
                         (Render/Composio adapters)  ┘ interface
  queue.ts               simulated mixed workload (batch + realtime)
  server.ts              SENSE→SCORE→DECIDE→ACT loop, SSE stream, demo controls
public/index.html        live dashboard (SSE, zero build step)
```

## Scaling path (sponsor integrations)

Each integration is a drop-in adapter — one line changes in `server.ts`:

| Layer | Today | With keys |
|---|---|---|
| SENSE | Open-Meteo | `JuaProvider` in `src/weather/jua.ts` — verify endpoint shape against real Jua docs first |
| DECIDE | Plain async agents | Wrap each agent call in Guild.ai governed sessions (identity, budget caps, kill switch) — agent bodies don't change |
| ACT | `SimulatedExecutor` | `RenderExecutor` (`POST /v1/services/{id}/scale`) + `ComposioExecutor` (Slack/GitHub actions) implementing `ActionExecutor` |
| Jobs | Simulated queue | Point `queue.ts` at a real queue (Celery/SQS/k8s jobs) — same `Job` shape |

## API

- `GET /api/state` — full snapshot (JSON)
- `GET /api/stream` — SSE, snapshot every 5s tick
- `POST /api/demo/heatwave {"dcId":"us-phoenix"}` — +12°C demo spike
- `POST /api/demo/reset` — jobs home, counters zeroed
