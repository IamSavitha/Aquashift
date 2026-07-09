import type { ActionExecutor, DataCenter } from "../types.js";

/**
 * Simulated executor — default for the demo. Same interface as the real
 * Render/Composio executors, so swapping in real infra is a one-line change
 * in server.ts.
 */
export class SimulatedExecutor implements ActionExecutor {
  name = "simulated";

  async scaleUp(dc: DataCenter, units: number): Promise<string> {
    await delay(400);
    return `[sim] scaled ${dc.region} capacity +${units} units (render: srv-${dc.id} → ${units} instances)`;
  }

  async pauseQueue(dc: DataCenter): Promise<string> {
    await delay(300);
    return `[sim] paused batch queue in ${dc.name} (github-actions: workflow_dispatch pause-queue)`;
  }

  async resumeQueue(dc: DataCenter): Promise<string> {
    await delay(300);
    return `[sim] resumed batch queue in ${dc.name}`;
  }

  async notify(message: string): Promise<string> {
    await delay(200);
    return `[sim] slack #aquashift-ops: "${message}"`;
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/*
 * Real adapters, when keys arrive:
 *
 * class RenderExecutor — POST https://api.render.com/v1/services/{srv}/scale
 *   { numInstances } with Bearer RENDER_API_KEY; suspend via
 *   POST /v1/services/{srv}/suspend.
 *
 * class ComposioExecutor — composio SDK executeAction() for SLACK_SEND_MESSAGE
 *   and GITHUB_ACTIONS_WORKFLOW_DISPATCH.
 *
 * Both implement ActionExecutor; nothing else in the codebase changes.
 */
