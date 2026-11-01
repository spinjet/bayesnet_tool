import { test, expect } from "@playwright/test";
test("real worker and WASM: priors, multiple targets, evidence, impossible evidence", async ({
  page,
}) => {
  await page.goto((process.env.TEST_PATH || "/") + "engine-proof.html");
  const model = {
    variables: [
      { id: "A", states: ["0", "1"] },
      { id: "B", states: ["0", "1"] },
      { id: "C", states: ["0", "1"] },
    ],
    cpts: [
      { variableId: "A", parentIds: [], values: [0.6, 0.4] },
      { variableId: "B", parentIds: ["A"], values: [0.9, 0.1, 0.2, 0.8] },
      { variableId: "C", parentIds: ["B"], values: [1, 0, 0, 1] },
    ],
  };
  const result: any = await page.evaluate(
    async (model) => (window as any).gate(model, { A: 1 }, ["B", "C"]),
    model,
  );
  expect(result.error).toBeUndefined();
  expect(result.result.prior.B[1]).toBeCloseTo(0.38, 10);
  expect(result.result.posterior.B[1]).toBeCloseTo(0.8, 10);
  expect(result.result.posterior.C[1]).toBeCloseTo(0.8, 10);
  const impossible: any = await page.evaluate(
    async (model) => (window as any).gate(model, { B: 1, C: 0 }, ["A"]),
    model,
  );
  expect(impossible.code).toBe("IMPOSSIBLE_EVIDENCE");
});
