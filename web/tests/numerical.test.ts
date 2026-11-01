import { test, expect } from "vitest";
import { createInProcessBN } from "jsagrum";
import { infer, type EngineModel } from "../src/engine";
import reference from "../fixtures/reference.json";
import { enumerate } from "./enumerate";

for (const [i, c] of reference.cases.entries())
  test(`pgmpy + exhaustive enumeration: unequal parent cardinalities, case ${i}`, async () => {
    const model = reference.model;
    const result = await infer(
      model,
      c.evidence as Record<string, number>,
      model.variables.map((v) => v.id),
      () => createInProcessBN(),
    );
    const exact = enumerate(model, c.evidence as Record<string, number>);
    for (const v of model.variables)
      for (let k = 0; k < v.states.length; k++) {
        expect(result.posterior[v.id][k]).toBeCloseTo(
          (c.expected as Record<string, number[]>)[v.id][k],
          10,
        );
        expect(result.posterior[v.id][k]).toBeCloseTo(exact[v.id][k], 10);
      }
  });
test("zero-probability evidence is rejected and next job recovers", async () => {
  const model: EngineModel = {
    variables: [
      { id: "A", states: ["0", "1"] },
      { id: "B", states: ["0", "1"] },
    ],
    cpts: [
      { variableId: "A", parentIds: [], values: [0.5, 0.5] },
      { variableId: "B", parentIds: ["A"], values: [1, 0, 0, 1] },
    ],
  };
  await expect(
    infer(model, { A: 1, B: 0 }, ["A"], () => createInProcessBN()),
  ).rejects.toMatchObject({ code: "IMPOSSIBLE_EVIDENCE" });
  const r = await infer(model, {}, ["B"], () => createInProcessBN());
  expect(r.posterior.B).toEqual([0.5, 0.5]);
});
test("chain, fork, disconnected components and seeded generated DAGs agree with enumeration", async () => {
  let seed = 493;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let sample = 0; sample < 12; sample++) {
    const variables = Array.from({ length: 4 }, (_, i) => ({
      id: `v${i}`,
      states: Array.from({ length: i === 2 ? 3 : 2 }, (_, k) => `s${k}`),
    }));
    const cpts = variables.map((v, i) => {
      const parentIds = variables
        .slice(0, i)
        .filter(() => random() < 0.45)
        .map((v) => v.id);
      const q = parentIds.reduce(
        (n, id) => n * variables.find((v) => v.id === id)!.states.length,
        1,
      );
      const values: number[] = [];
      for (let row = 0; row < q; row++) {
        const weights = v.states.map(() => random() + 0.05),
          sum = weights.reduce((a, b) => a + b, 0);
        values.push(...weights.map((x) => x / sum));
      }
      return { variableId: v.id, parentIds, values };
    });
    const model = { variables, cpts };
    const evidence: Record<string, number> = sample % 2 ? { v0: 1, v3: 0 } : {};
    const expected = enumerate(model, evidence),
      result = await infer(
        model,
        evidence,
        variables.map((v) => v.id),
        () => createInProcessBN(),
      );
    for (const v of variables)
      for (let k = 0; k < v.states.length; k++)
        expect(result.posterior[v.id][k]).toBeCloseTo(expected[v.id][k], 10);
  }
});

test("single root, fork and disconnected component marginals", async () => {
  const root = { id: "A", states: ["α", "β"] };
  const models: EngineModel[] = [
    {
      variables: [root],
      cpts: [{ variableId: "A", parentIds: [], values: [0.7, 0.3] }],
    },
    {
      variables: [
        root,
        { id: "B", states: ["no", "yes"] },
        { id: "C", states: ["low", "high"] },
        { id: "D", states: ["0", "1"] },
      ],
      cpts: [
        { variableId: "A", parentIds: [], values: [0.7, 0.3] },
        { variableId: "B", parentIds: ["A"], values: [0.9, 0.1, 0.2, 0.8] },
        { variableId: "C", parentIds: ["A"], values: [0.6, 0.4, 0.1, 0.9] },
        { variableId: "D", parentIds: [], values: [0.25, 0.75] },
      ],
    },
  ];
  for (const model of models) {
    const evidence = { A: 1 };
    const expected = enumerate(model, evidence),
      r = await infer(
        model,
        evidence,
        model.variables.map((v) => v.id),
        () => createInProcessBN(),
      );
    for (const v of model.variables)
      r.posterior[v.id].forEach((p, k) =>
        expect(p).toBeCloseTo(expected[v.id][k], 10),
      );
  }
});

for (const [index, c] of reference.cases.entries())
  test(`all joint cells agree with pgmpy: case ${index}`, async () => {
    const groups = c.joints.map((g, i) => ({
      id: String(i),
      targetIds: g.targetIds,
    }));
    const result = await infer(
      reference.model,
      c.evidence as Record<string, number>,
      reference.model.variables.map((v) => v.id),
      () => createInProcessBN(),
      groups,
    );
    for (const [i, g] of c.joints.entries())
      g.expected.forEach((expected, k) =>
        expect(result.groups[String(i)].posterior[k]).toBeCloseTo(expected, 10),
      );
  });
