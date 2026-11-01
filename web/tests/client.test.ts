import { test, expect, vi } from "vitest";
import { ComputeClient } from "../src/client";
test("cancel terminates worker, rejects pending work and creates fresh worker", async () => {
  const workers: any[] = [];
  const factory = () => {
    const w = {
      onmessage: null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
      onerror: null,
    };
    workers.push(w);
    return w as unknown as Worker;
  };
  const client = new ComputeClient(factory);
  const cancelled = client.request("infer", {});
  const assertion = expect(cancelled).rejects.toMatchObject({
    code: "CANCELLED",
  });
  client.cancel();
  await assertion;
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  const next = client.request("infer", {});
  workers[1].onmessage({ data: { id: 2, result: { ok: true } } });
  await expect(next).resolves.toEqual({ ok: true });
});
test("late responses cannot fulfil a different request; watchdog permits retry", async () => {
  vi.useFakeTimers();
  const workers: any[] = [];
  const client = new ComputeClient(() => {
    const w = {
      onmessage: null,
      onerror: null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    };
    workers.push(w);
    return w as unknown as Worker;
  });
  const p = client.request("train", {});
  const assertion = expect(p).rejects.toMatchObject({ code: "RESOURCE_LIMIT" });
  await vi.advanceTimersByTimeAsync(30000);
  await assertion;
  expect(workers[0].terminate).toHaveBeenCalled();
  const retry = client.request("train", {});
  workers[0].onmessage({ data: { id: 1, result: "late" } });
  workers[1].onmessage({ data: { id: 2, result: "fresh" } });
  await expect(retry).resolves.toBe("fresh");
  vi.useRealTimers();
});
