import { test, expect } from "vitest";
import {
  emptyProject,
  validateProject,
  signature,
  stateLabel,
  precisionWarning,
  invalidate,
} from "../src/domain";
import { parseCsv, configureVariable, train, encode } from "../src/processing";
import { infer, validateQueries } from "../src/engine";
import { createInProcessBN } from "jsagrum";
import { enumerate, enumerateJoint } from "./enumerate";
async function setup() {
  const d = await parseCsv(
    "A,B\nx,no\nx,no\nx,no\nx,yes\ny,yes\n",
    "biased.csv",
    "",
    [""],
  );
  const p = emptyProject();
  p.dataset = {
    name: d.name,
    hash: d.hash,
    headers: d.headers,
    rowCount: d.rows.length,
    delimiter: d.delimiter,
  };
  p.variables = d.headers.map((_, i) =>
    configureVariable(d, p, `c${i}`, "categorical", "equalWidth", 2, []),
  );
  p.edges = [
    { id: "edge", source: p.variables[0].id, target: p.variables[1].id },
  ];
  p.cpts = train(d, p, "mle", 0).cpts;
  p.queryGroups = [
    { id: "q", name: "A × B", targetIds: p.variables.map((v) => v.id) },
  ];
  return { p, d };
}
test("state display changes leave source encoding, CPT signatures and probabilities unchanged", async () => {
  const { p } = await setup(),
    v = p.variables[0],
    before = signature(p, v.id),
    values = p.cpts.map((c) => [...c.values]);
  v.stateLabels = ["First", "Second"];
  expect(encode(v, "x")).toBe(0);
  expect(signature(p, v.id)).toBe(before);
  invalidate(p);
  expect(p.cpts.map((c) => c.values)).toEqual(values);
  expect(validateProject(p).variables[0].stateLabels).toEqual([
    "First",
    "Second",
  ]);
  v.stateLabels = ["Same", "Same"];
  expect(() => validateProject(p)).toThrow("unique");
});
test("precision is display-only and warns about rounded neighbouring cuts", async () => {
  const { p, d } = await setup();
  const v = configureVariable(
    {
      ...d,
      rows: [
        ["0", "no"],
        [".0001", "yes"],
        [".0002", "yes"],
      ],
    },
    p,
    "c0",
    "discretised",
    "manual",
    3,
    [0.00005, 0.00015],
  );
  const cuts = [...v.binning!.cuts],
    states = [...v.states];
  expect(precisionWarning(v)).toBe(true);
  v.displayDecimals = 5;
  expect(precisionWarning(v)).toBe(false);
  expect(stateLabel(v, 1)).toBe("[0.00005, 0.00015)");
  expect(v.binning!.cuts).toEqual(cuts);
  expect(v.states).toEqual(states);
  expect(encode(v, ".00015")).toBe(2);
});
test("uniform root removes its sampling bias, retains counts, and posterior can change", async () => {
  const { p, d } = await setup();
  const root = p.variables[0];
  const learnedChild = [...p.cpts[1].values];
  root.parameterMode = "uniform";
  invalidate(p);
  expect(p.cpts).toHaveLength(1);
  p.cpts = train(d, p, "mle", 0).cpts;
  expect(p.cpts[0]).toMatchObject({
    origin: "uniform",
    values: [0.5, 0.5],
    counts: [4, 1],
  });
  expect(p.cpts[1].values).toEqual(learnedChild);
  const r = await infer(p, { [p.variables[1].id]: 1 }, [root.id], () =>
    createInProcessBN(),
  );
  expect(r.prior[root.id]).toEqual([0.5, 0.5]);
  expect(r.posterior[root.id][1]).toBeCloseTo(0.8, 10);
  expect(validateProject(p).cpts[0].origin).toBe("uniform");
});
test("uniform child is equal in every parent row, including unobserved rows under MLE", async () => {
  const { p, d } = await setup();
  const extra = { ...p.variables[0], id: crypto.randomUUID(), label: "Extra" };
  p.variables.push(extra);
  p.edges.push({ id: "extra", source: extra.id, target: p.variables[1].id });
  p.variables[1].parameterMode = "uniform";
  p.cpts = train(d, p, "mle", 0).cpts;
  expect(p.cpts[1].values).toEqual(Array(8).fill(0.5));
  expect(p.cpts[1].rowCounts).toContain(0);
  expect(p.cpts[1].counts.reduce((a, b) => a + b, 0)).toBe(5);
});
test("validated v1 migration retains numerical artifacts and creates query groups", async () => {
  const { p } = await setup();
  const old: any = structuredClone(p);
  old.schemaVersion = 1;
  old.targetIds = old.variables.map((v: any) => v.id);
  delete old.queryGroups;
  for (const v of old.variables) {
    delete v.stateLabels;
    delete v.displayDecimals;
    delete v.parameterMode;
  }
  for (const c of old.cpts)
    c.signature = JSON.stringify([
      c.variableId,
      old.variables.find((v: any) => v.id === c.variableId).states,
      c.parentIds.map((id: string) => [
        id,
        old.variables.find((v: any) => v.id === id).states,
      ]),
    ]);
  old.evidence = { [old.variables[0].id]: 1 };
  const migrated = validateProject(old);
  expect(migrated.schemaVersion).toBe(2);
  expect(migrated.queryGroups.map((g) => g.targetIds)).toEqual(
    old.targetIds.map((id: string) => [id]),
  );
  expect(migrated.cpts.map((c) => c.values)).toEqual(
    old.cpts.map((c: any) => c.values),
  );
  expect(migrated.evidence).toEqual(old.evidence);
  expect(migrated.variables[0]).toMatchObject({
    displayDecimals: 2,
    parameterMode: "learned",
    stateLabels: old.variables[0].states,
  });
  expect(validateProject(JSON.parse(JSON.stringify(migrated)))).toEqual(
    migrated,
  );
  const extended = structuredClone(old);
  for (let i = 0; i < 9; i++)
    extended.variables.push({
      ...extended.variables[0],
      id: crypto.randomUUID(),
    });
  extended.targetIds = extended.variables.map((v: any) => v.id);
  const many = validateProject(extended);
  expect(many.queryGroups).toHaveLength(11);
  expect(() => validateQueries(many.variables, many.queryGroups)).toThrow(
    "10 query",
  );
  const collision = structuredClone(old);
  collision.variables[0].states = [" x", "x "];
  collision.variables[0].label = "A".repeat(200);
  for (const c of collision.cpts)
    c.signature = JSON.stringify([
      c.variableId,
      collision.variables.find((v: any) => v.id === c.variableId).states,
      c.parentIds.map((id: string) => [
        id,
        collision.variables.find((v: any) => v.id === id).states,
      ]),
    ]);
  expect(validateProject(collision).variables[0].stateLabels).toEqual([
    "x",
    "x (2)",
  ]);
  expect(validateProject(collision).queryGroups[0].name).toHaveLength(100);
  old.cpts[0].values = [0.8, 0.8];
  expect(() => validateProject(old)).toThrow("sum");
});
test("query budgets reject before creating a native engine", async () => {
  const model = {
    variables: Array.from({ length: 4 }, (_, i) => ({
      id: String(i),
      states: Array(64).fill("state"),
    })),
    cpts: [],
  };
  const groups = [{ id: "q", targetIds: ["0", "1", "2"] }];
  let created = false;
  await expect(
    infer(
      model,
      {},
      [],
      async () => {
        created = true;
        return createInProcessBN();
      },
      groups,
    ),
  ).rejects.toMatchObject({ code: "RESOURCE_LIMIT" });
  expect(created).toBe(false);
  expect(() =>
    validateQueries(
      model.variables,
      Array.from({ length: 11 }, (_, i) => ({
        id: String(i),
        targetIds: ["0"],
      })),
    ),
  ).toThrow("10 query");
  expect(() =>
    validateQueries(
      model.variables,
      Array.from({ length: 3 }, (_, i) => ({
        id: String(i),
        targetIds: ["0", "1"],
      })),
    ),
  ).toThrow("8,192");
});
test("exact joints preserve dependence, observed axes and zero-probability branches", async () => {
  const model = {
    variables: [
      { id: "A", states: ["0", "1"] },
      { id: "B", states: ["0", "1"] },
      { id: "C", states: ["0", "1", "2"] },
    ],
    cpts: [
      { variableId: "A", parentIds: [], values: [0.6, 0.4] },
      { variableId: "B", parentIds: ["A"], values: [1, 0, 0, 1] },
      {
        variableId: "C",
        parentIds: ["B"],
        values: [0.2, 0.3, 0.5, 0.6, 0.4, 0],
      },
    ],
  };
  for (const evidence of [{}, { A: 1 }, { C: 1 }] as Record<string, number>[]) {
    const groups = [
      { id: "pair", targetIds: ["B", "A"] },
      { id: "triple", targetIds: ["C", "A", "B"] },
    ];
    const r = await infer(
      model,
      evidence,
      model.variables.map((v) => v.id),
      () => createInProcessBN(),
      groups,
    );
    for (const g of groups) {
      const joint = r.groups[g.id];
      const exactJoint = enumerateJoint(model, evidence, g.targetIds);
      joint.posterior.forEach((p, k) =>
        expect(p).toBeCloseTo(exactJoint[k], 10),
      );
      expect(joint.posterior.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
      const exact = enumerate(model, evidence);
      for (let axis = 0; axis < g.targetIds.length; axis++) {
        const marginal = Array(joint.shape[axis]).fill(0);
        joint.posterior.forEach((p, index) => {
          const stride = joint.shape.slice(axis + 1).reduce((a, b) => a * b, 1);
          marginal[Math.floor(index / stride) % joint.shape[axis]] += p;
        });
        marginal.forEach((p, k) => {
          expect(p).toBeCloseTo(exact[g.targetIds[axis]][k], 10);
          expect(p).toBeCloseTo(r.posterior[g.targetIds[axis]][k], 10);
        });
      }
    }
    expect(r.groups.pair.posterior[1]).toBe(0);
    expect(r.groups.pair.posterior[2]).toBe(0);
  }
});
