import type { EngineModel, Evidence } from "./engine";
const worker = new Worker(new URL("./gate.worker.ts", import.meta.url), {
  type: "module",
});
declare global {
  interface Window {
    gate: (
      model: EngineModel,
      evidence: Evidence,
      targets: string[],
    ) => Promise<unknown>;
  }
}
window.gate = (model, evidence, targets) =>
  new Promise((resolve) => {
    worker.onmessage = (e) => resolve(e.data);
    worker.postMessage({
      model,
      evidence,
      targets,
      engineUrl: new URL(
        `${import.meta.env.BASE_URL}vendor/jsagrum/dist/index.js`,
        location.origin,
      ).href,
    });
  });
document.querySelector("#app")!.textContent =
  "Engine feasibility probe. Synthetic models only.";
