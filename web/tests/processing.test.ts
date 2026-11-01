import { test, expect } from "vitest";
import {
  parseCsv,
  cutsFor,
  configureVariable,
  prepareRows,
  train,
  encode,
} from "../src/processing";
import {
  emptyProject,
  validateProject,
  cyclicNodes,
  invalidate,
  signature,
} from "../src/domain";
async function fixture(csv = "A,B\nx,no\nx,no\ny,yes\ny,yes\n") {
  const d = await parseCsv(csv, "test.csv", "", [""]);
  const p = emptyProject();
  p.dataset = {
    name: d.name,
    hash: d.hash,
    rowCount: d.rows.length,
    headers: d.headers,
    delimiter: d.delimiter,
  };
  p.variables = d.headers
    .slice(0, 2)
    .map((_, i) =>
      configureVariable(d, p, `c${i}`, "categorical", "equalWidth", 2, []),
    );
  p.edges = [
    { id: "edge", source: p.variables[0].id, target: p.variables[1].id },
  ];
  return { d, p };
}
test("quoted CSV, BOM, missing tokens and malformed headers", async () => {
  const d = await parseCsv(
    '\uFEFFA,B\n"hello, world","line1\nline2"\nNA,\n',
    "q.csv",
    "",
    [""],
  );
  expect(d.rows[0]).toEqual(["hello, world", "line1\nline2"]);
  expect(d.profiles[0].missing).toBe(0);
  expect(d.profiles[1].missing).toBe(1);
  await expect(parseCsv("A,A\n1,2", "bad", "", [""])).rejects.toThrow("unique");
  await expect(parseCsv("A,B\n1,2,3", "bad", "", [""])).rejects.toThrow(
    "same number",
  );
});
test("equal-width and quantile boundaries, duplicate cuts and constants", () => {
  expect(cutsFor([0, 10, 20], "equalWidth", 2)).toEqual([10]);
  expect(cutsFor([0, 10, 20, 30], "quantile", 2)).toEqual([15]);
  expect(cutsFor([0, 0, 0, 1, 1], "quantile", 4)).toEqual([0, 1]);
});
test("constant, invalid numeric and manual cuts are rejected", () => {
  expect(() => cutsFor([1, 1], "equalWidth", 3)).toThrow("Constant");
  expect(() => cutsFor([0, 1], "manual", 3, [1, 1])).toThrow("strictly");
  expect(() => cutsFor([0, NaN], "equalWidth", 3)).toThrow("finite");
});
test("numeric cuts include upper bin and apply to outside-range observations", async () => {
  const { d, p } = await fixture("A,B\n0,no\n10,no\n20,yes\n30,yes\n");
  const v = configureVariable(d, p, "c0", "discretised", "manual", 3, [10, 20]);
  expect(["-100", "0", "10", "20", "100"].map((x) => encode(v, x))).toEqual([
    0, 0, 1, 2, 2,
  ]);
  expect(() => encode(v, "bad")).toThrow();
});
test("hand-counted MLE and Dirichlet CPTs", async () => {
  const { d, p } = await fixture();
  const mle = train(d, p, "mle", 0);
  expect(mle.cpts[0].values).toEqual([0.5, 0.5]);
  expect(mle.cpts[1].counts).toEqual([2, 0, 0, 2]);
  expect(mle.cpts[1].values).toEqual([1, 0, 0, 1]);
  expect(train(d, p, "dirichlet", 1).cpts[1].values).toEqual([
    0.75, 0.25, 0.25, 0.75,
  ]);
  p.cpts = mle.cpts;
  expect(validateProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
});
test("complete records only, selected columns, empty effective data", async () => {
  const { d, p } = await fixture("A,B,Unused\nx,no,\nx,,\ny,yes,\ny,yes,\n");
  p.variables = p.variables.slice(0, 2);
  expect(prepareRows(d, p)).toMatchObject({ retained: 3, dropped: 1 });
  p.missingTokens = ["", "x", "y"];
  expect(() => prepareRows(d, p)).toThrow("No complete");
});
test("unobserved MLE configuration blocks; Dirichlet resolves explicitly", async () => {
  const { d, p } = await fixture("A,B\nx,no\ny,yes\nx,yes\ny,no\n");
  const third = {
    ...p.variables[0],
    id: "third",
    columnId: "c0",
    label: "third",
  };
  p.variables.push(third);
  p.edges.push({
    id: "thirdEdge",
    source: third.id,
    target: p.variables[1].id,
  });
  expect(() => train(d, p, "mle", 0)).toThrow("unobserved");
  expect(train(d, p, "dirichlet", 1).cpts[1].rowCounts).toContain(0);
});
test("cycle detection, selective CPT invalidation and label/layout invariance", async () => {
  const { d, p } = await fixture();
  p.cpts = train(d, p, "dirichlet", 1).cpts;
  const before = signature(p, p.variables[1].id);
  p.variables[0].label = "Renamed";
  p.variables[0].position.x = 900;
  expect(signature(p, p.variables[1].id)).toBe(before);
  p.edges = [];
  invalidate(p);
  expect(p.cpts.map((c) => c.variableId)).toEqual([p.variables[0].id]);
  p.edges = [
    { id: "1", source: p.variables[0].id, target: p.variables[1].id },
    { id: "2", source: p.variables[1].id, target: p.variables[0].id },
  ];
  expect(cyclicNodes(p)).toHaveLength(2);
  expect(() => train(d, p, "dirichlet", 1)).toThrow("cycle");
  p.cpts = [];
  expect(validateProject(p)).toEqual(p);
});
test("project validation preserves cyclic drafts but rejects invalid CPTs, future schema, unknown states", async () => {
  const { d, p } = await fixture();
  p.cpts = train(d, p, "mle", 0).cpts;
  const bad = structuredClone(p);
  bad.cpts[0].values = [0.7, 0.7];
  expect(() => validateProject(bad)).toThrow("sum");
  expect(() => validateProject({ ...p, schemaVersion: 99 })).toThrow();
  expect(() => validateProject({ ...p, evidence: { unknown: 0 } })).toThrow(
    "evidence",
  );
});

test("CPT allocation is guarded before counting; large drafts can still be saved", async () => {
  const { d, p } = await fixture();
  const child = p.variables[1];
  const roots = Array.from({ length: 20 }, () => ({
    ...p.variables[0],
    id: crypto.randomUUID(),
  }));
  p.variables = [...roots, child];
  p.edges = roots.map((v, i) => ({
    id: String(i),
    source: v.id,
    target: child.id,
  }));
  expect(() => train(d, p, "dirichlet", 1)).toThrow("1,000,000");
  expect(validateProject(p).cpts).toEqual([]);
});
