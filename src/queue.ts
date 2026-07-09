import type { Job, JobType } from "./types.js";

const JOB_TEMPLATES: Array<{ name: string; type: JobType; latencySensitive: boolean }> = [
  { name: "LLM fine-tune (llama-70b)", type: "batch-training", latencySensitive: false },
  { name: "Embedding backfill", type: "batch-inference", latencySensitive: false },
  { name: "Nightly eval suite", type: "batch-inference", latencySensitive: false },
  { name: "Video transcode batch", type: "batch-inference", latencySensitive: false },
  { name: "RLHF reward model train", type: "batch-training", latencySensitive: false },
  { name: "Dataset dedup pipeline", type: "batch-inference", latencySensitive: false },
  { name: "Chat completions API", type: "realtime-api", latencySensitive: true },
  { name: "Search ranking service", type: "realtime-api", latencySensitive: true },
  { name: "Fraud scoring endpoint", type: "realtime-api", latencySensitive: true },
];

let nextId = 1;

function makeJob(dcId: string, template: (typeof JOB_TEMPLATES)[number]): Job {
  const computeUnits = template.latencySensitive
    ? 5 + Math.floor(Math.random() * 10)
    : 8 + Math.floor(Math.random() * 16);
  return {
    id: `job-${nextId++}`,
    name: template.name,
    type: template.type,
    computeUnits,
    // ~0.7 kWh per compute unit per hour (H100-class node draw)
    kwhPerHour: Math.round(computeUnits * 0.7 * 10) / 10,
    latencySensitive: template.latencySensitive,
    status: "running",
    dcId,
    homeDcId: dcId,
  };
}

/** Seed each data center with a realistic mixed workload. */
export function seedJobs(dcIds: string[]): Job[] {
  const jobs: Job[] = [];
  for (const dcId of dcIds) {
    // every DC runs some real-time services (unmovable)
    for (const t of JOB_TEMPLATES.filter((t) => t.latencySensitive)) {
      jobs.push(makeJob(dcId, t));
    }
    // and a random selection of batch work (shiftable)
    const batch = JOB_TEMPLATES.filter((t) => !t.latencySensitive);
    const count = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      jobs.push(makeJob(dcId, batch[Math.floor(Math.random() * batch.length)]));
    }
  }
  return jobs;
}

export function usedCapacity(jobs: Job[], dcId: string): number {
  return jobs
    .filter((j) => j.dcId === dcId && j.status !== "paused")
    .reduce((sum, j) => sum + j.computeUnits, 0);
}
