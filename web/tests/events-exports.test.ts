import { test, expect } from "vitest";
import { createInProcessBN } from "jsagrum";
import { infer } from "../src/engine";
import {
  emptyProject,
  allowedStates,
  resolveEvidence,
  validateProject,
  signature,
} from "../src/domain";
import { parseCsv, configureVariable, train, encode } from "../src/processing";
import { nextUp, nextDown } from "../src/numbers";
import { sampleArchive } from "../src/sampling";
import { graphSvg, graphDot } from "../src/graph-export";
import Papa from "papaparse";
import { unzipSync, strFromU8 } from "fflate";
async function setup() {
  const d = await parseCsv("A,B\n0,x\n1,y\n2,y\n3,z\n", "test.csv", "", [""]);
  const p = emptyProject();
  p.dataset = {
    name: d.name,
    hash: d.hash,
    headers: d.headers,
    rowCount: 4,
    delimiter: d.delimiter,
  };
  p.variables = d.headers.map((_, i) =>
    configureVariable(
      d,
      p,
      `c${i}`,
      i === 0 ? "discretised" : "categorical",
      "manual",
      3,
      i === 0 ? [1, 3] : [],
    ),
  );
  p.edges = [
    {
      id: "e",
      source: p.variables[0].id,
      target: p.variables[1].id,
      sourceHandle: "top",
      targetHandle: "bottom",
    },
  ];
  p.cpts = train(d, p, "dirichlet", 1).cpts;
  p.queryGroups = [
    { id: "q", name: "joint", targetIds: p.variables.map((v) => v.id) },
  ];
  return { p, d };
}
test("multiple state events use exact conditioning without changing priors, model or output IDs", async () => {
  const { p } = await setup(),
    [a, b] = p.variables;
  const before = JSON.stringify(p);
  const r = await infer(
    p,
    { [a.id]: [1, 2], [b.id]: [0, 1] },
    p.variables.map((v) => v.id),
    () => createInProcessBN(),
    p.queryGroups,
  );
  const expected = Array(9).fill(0);
  let mass = 0;
  for (let i = 1; i < 3; i++)
    for (let j = 0; j < 2; j++) {
      const weight = p.cpts[0].values[i] * p.cpts[1].values[i * 3 + j];
      expected[i * 3 + j] = weight;
      mass += weight;
    }
  expected.forEach((x, i) =>
    expect(r.groups.q.posterior[i]).toBeCloseTo(x / mass, 12),
  );
  expect(r.posterior[a.id][0]).toBe(0);
  expect(r.posterior[a.id][1]).toBeGreaterThan(0);
  expect(Object.keys(r.posterior)).toHaveLength(2);
  expect(JSON.stringify(p)).toBe(before);
  const prior = await infer(p, {}, [a.id], () => createInProcessBN());
  expect(r.prior[a.id]).toEqual(prior.prior[a.id]);
});
test("impossible and tautological event evidence, zero deterministic branches, and recovery", async () => {
  const model = {
    variables: [
      { id: "a", states: ["0", "1", "2"] },
      { id: "b", states: ["0", "1", "2"] },
    ],
    cpts: [
      { variableId: "a", parentIds: [], values: [0.2, 0.3, 0.5] },
      {
        variableId: "b",
        parentIds: ["a"],
        values: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      },
    ],
  };
  await expect(
    infer(model, { a: [0, 1], b: [2] }, ["a"], () => createInProcessBN()),
  ).rejects.toMatchObject({ code: "IMPOSSIBLE_EVIDENCE" });
  await expect(
    infer(model, { a: [] }, ["a"], () => createInProcessBN()),
  ).rejects.toMatchObject({ code: "IMPOSSIBLE_EVIDENCE" });
  const r = await infer(model, { a: [0, 1, 2] }, ["a"], () =>
    createInProcessBN(),
  );
  expect(r.posterior.a).toEqual([0.2, 0.3, 0.5]);
});
test("all threshold operators respect exact boundaries; split-bin drafts round-trip", async () => {
  const { p } = await setup(),
    v = p.variables[0];
  expect(
    allowedStates(v, { kind: "threshold", operator: "gte", value: 1 }),
  ).toEqual([1, 2]);
  expect(
    allowedStates(v, { kind: "threshold", operator: "lt", value: 1 }),
  ).toEqual([0]);
  expect(() =>
    allowedStates(v, { kind: "threshold", operator: "gt", value: 1 }),
  ).toThrow("splits a bin");
  v.binning!.cuts = [1, nextUp(1)];
  expect(
    allowedStates(v, { kind: "threshold", operator: "gt", value: 1 }),
  ).toEqual([2]);
  expect(
    allowedStates(v, { kind: "threshold", operator: "lte", value: 1 }),
  ).toEqual([0, 1]);
  expect(encode(v, "1")).toBe(1);
  expect(encode(v, String(nextUp(1)))).toBe(2);
  p.cpts = [];
  p.evidence[v.id] = { kind: "threshold", operator: "gte", value: 2 };
  expect(validateProject(p).evidence).toEqual(p.evidence);
  expect(() => resolveEvidence(p)).toThrow("splits a bin");
  v.representation = "finiteNumeric";
  v.binning = undefined;
  v.states = ["0", "1", "2"];
  expect(
    allowedStates(v, { kind: "threshold", operator: "gt", value: 1 }),
  ).toEqual([2]);
  expect(
    allowedStates(v, { kind: "threshold", operator: "lt", value: 0 }),
  ).toEqual([]);
});
test("next representable bounds preserve signed and extreme doubles", () => {
  for (const x of [-1e300, -1, 0, 1, 1e300]) {
    expect(nextUp(x)).toBeGreaterThan(x);
    expect(nextDown(x)).toBeLessThan(x);
  }
  expect(nextUp(Number.MAX_VALUE)).toBe(Infinity);
  expect(nextDown(Infinity)).toBe(Number.MAX_VALUE);
  expect(nextUp(-Infinity)).toBe(-Number.MAX_VALUE);
});
test("v2 migration preserves CPT validity, evidence and layout; ports are presentation only", async () => {
  const { p } = await setup();
  const old = { ...p, schemaVersion: 2 };
  const migrated = validateProject(old);
  expect(migrated.schemaVersion).toBe(3);
  expect(migrated.cpts).toEqual(p.cpts);
  expect(migrated.variables).toEqual(p.variables);
  expect(migrated.edges[0].sourceHandle).toBe("right");
  const before = signature(p, p.variables[1].id);
  p.edges[0].sourceHandle = "bottom";
  expect(signature(p, p.variables[1].id)).toBe(before);
  expect(validateProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
});
test("seeded ZIP samples preserve forbidden joint cells and numeric bins, with provenance", async () => {
  const { p } = await setup(),
    [a, b] = p.variables;
  const joint = {
    targetIds: [a.id, b.id],
    shape: [3, 3],
    prior: Array(9).fill(0),
    posterior: [0.25, 0, 0, 0, 0.75, 0, 0, 0, 0],
  };
  const options = {
    count: 10000,
    seed: 42,
    bounds: { [a.id]: { min: -2, max: 4 } },
  };
  const archive = sampleArchive(p, "q", joint, options).archive;
  expect(sampleArchive(p, "q", joint, options).archive).toEqual(archive);
  const files = unzipSync(archive),
    rows = Papa.parse<string[]>(strFromU8(files["samples.csv"])).data.slice(1);
  expect(rows).toHaveLength(10000);
  for (const [x, y] of rows) {
    if (y === "x") expect(Number(x)).toBeLessThan(1);
    else {
      expect(y).toBe("y");
      expect(Number(x)).toBeGreaterThanOrEqual(1);
      expect(Number(x)).toBeLessThan(3);
    }
  }
  const ratio = rows.filter((r) => r[1] === "x").length / rows.length;
  expect(ratio).toBeCloseTo(0.25, 1);
  expect(JSON.parse(strFromU8(files["manifest.json"]))).toMatchObject({
    seed: 42,
    count: 10000,
    sampler: "joint-cdf/mulberry32-v1",
  });
  expect(() =>
    sampleArchive(p, "q", joint, {
      ...options,
      bounds: { [a.id]: { min: 1, max: 4 } },
    }),
  ).toThrow("positive-probability");
  expect(() =>
    sampleArchive(p, "q", joint, { ...options, count: 100001 }),
  ).toThrow("100,000");
});
test("finite numeric exact values and categorical aliases are sampled, CSV formulas escaped", async () => {
  const { p } = await setup(),
    [a, b] = p.variables;
  a.representation = "finiteNumeric";
  a.binning = undefined;
  a.states = ["1", "2", "3"];
  b.stateLabels = ["=BAD", "Y", "Z"];
  const joint = {
    targetIds: [a.id, b.id],
    shape: [3, 3],
    prior: Array(9).fill(0),
    posterior: [1, 0, 0, 0, 0, 0, 0, 0, 0],
  };
  const files = unzipSync(
    sampleArchive(p, "q", joint, { count: 2, seed: 0, bounds: {} }).archive,
  );
  expect(strFromU8(files["samples.csv"])).toContain('"1","\'=BAD"');
});
test("Graphviz renders escaped names, four-side ports and optional probability labels", async () => {
  const { p } = await setup();
  p.variables[0].label = 'A "quoted" <script>alert(1)</script>';
  const dot = graphDot(p);
  expect(dot).toContain("n0:n -> n1:s");
  expect(dot).toContain('\\"quoted\\"');
  const svg = await graphSvg(p);
  expect(svg).toContain("<svg");
  expect(svg).not.toContain("<script>");
  expect(svg).not.toContain("<!DOCTYPE");
  expect(svg).not.toContain("__event_");
  const probs = Object.fromEntries(
    p.variables.map((v) => [v.id, v.states.map(() => 1 / 3)]),
  );
  expect(await graphSvg(p, probs)).toContain("33.333%");
});

test("numeric samples satisfy all inclusive and strict threshold predicates", async () => {
  const { p, d } = await setup();
  p.variables[0] = configureVariable(d, p, "c0", "discretised", "manual", 3, [
    1,
    nextUp(1),
  ]);
  p.cpts = train(d, p, "dirichlet", 1).cpts;
  const id = p.variables[0].id;
  for (const operator of ["gte", "gt", "lt", "lte"] as const) {
    p.evidence[id] = { kind: "threshold", operator, value: 1 };
    const result = await infer(
      p,
      resolveEvidence(p),
      p.variables.map((v) => v.id),
      () => createInProcessBN(),
      p.queryGroups,
    );
    const zip = unzipSync(
      sampleArchive(p, "q", result.groups.q, {
        count: 500,
        seed: 9,
        bounds: { [id]: { min: -2, max: 4 } },
      }).archive,
    );
    const rows = Papa.parse<string[]>(strFromU8(zip["samples.csv"])).data.slice(
      1,
    );
    for (const row of rows) {
      const x = Number(row[0]);
      expect(
        operator === "gte"
          ? x >= 1
          : operator === "gt"
            ? x > 1
            : operator === "lt"
              ? x < 1
              : x <= 1,
      ).toBe(true);
    }
  }
});
