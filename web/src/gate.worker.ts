import { infer } from "./engine";
self.onmessage = async ({ data }) => {
  try {
    const { createInProcessBN } = await import(
      /* @vite-ignore */ data.engineUrl
    );
    const result = await infer(data.model, data.evidence, data.targets, () =>
      createInProcessBN(),
    );
    self.postMessage({ result });
  } catch (e) {
    self.postMessage({ error: String(e), code: (e as { code?: string }).code });
  }
};
