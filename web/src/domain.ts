import { z } from "zod";
import { ModelError } from "./engine";
import { validateProject as validateV1 } from "./legacy-v1";
export const LIMITS = {
  fileBytes: 100 * 1024 * 1024,
  states: 64,
  cptCells: 1_000_000,
  totalCells: 5_000_000,
  rows: 1_000_000,
  columns: 500,
};
const finite = z.number().finite();
export const variableSchema = z.object({
  id: z.uuid(),
  label: z.string().min(1).max(200),
  columnId: z.string(),
  representation: z.enum(["categorical", "finiteNumeric", "discretised"]),
  states: z.array(z.string()).min(2).max(LIMITS.states),
  stateLabels: z
    .array(z.string().trim().min(1).max(200))
    .min(2)
    .max(LIMITS.states),
  displayDecimals: z.number().int().min(0).max(12),
  parameterMode: z.enum(["learned", "uniform"]),
  binning: z
    .object({
      method: z.enum(["manual", "equalWidth", "quantile"]),
      cuts: z.array(finite).max(63),
      requestedBins: z.number().int().min(2).max(64),
      fittedRange: z.tuple([finite, finite]),
      algorithmVersion: z.literal("1"),
      closure: z.literal("leftClosed"),
    })
    .optional(),
  position: z.object({ x: finite, y: finite }),
});
export const cptSchema = z.object({
  variableId: z.string(),
  parentIds: z.array(z.string()),
  values: z.array(finite).max(LIMITS.cptCells),
  counts: z.array(z.number().int().nonnegative()).max(LIMITS.cptCells),
  rowCounts: z.array(z.number().int().nonnegative()),
  signature: z.string(),
  origin: z.enum(["mle", "dirichlet", "uniform"]),
  alphaPerCell: finite.nonnegative(),
  datasetHash: z.string(),
  trainedAt: z.string(),
});
export const queryGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  targetIds: z.array(z.string()).max(100),
});
export type QueryGroup = z.infer<typeof queryGroupSchema>;
export const projectSchema = z.object({
  schemaVersion: z.literal(2),
  id: z.string(),
  name: z.string().min(1).max(200),
  variables: z.array(variableSchema).max(100),
  edges: z
    .array(z.object({ id: z.string(), source: z.string(), target: z.string() }))
    .max(1000),
  cpts: z.array(cptSchema).max(100),
  evidence: z.record(z.string(), z.number().int().nonnegative()),
  queryGroups: z.array(queryGroupSchema).max(100),
  dataset: z
    .object({
      name: z.string(),
      hash: z.string(),
      rowCount: z.number().int().nonnegative(),
      headers: z.array(z.string()),
      delimiter: z.string(),
      embeddedCsv: z.string().optional(),
    })
    .optional(),
  missingTokens: z.array(z.string()).max(100),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Variable = z.infer<typeof variableSchema>;
export type Cpt = z.infer<typeof cptSchema>;
export type Project = z.infer<typeof projectSchema>;
export const datasetSchema = z.object({
  name: z.string(),
  hash: z.string(),
  headers: z.array(z.string()).max(LIMITS.columns),
  rows: z.array(z.array(z.string())).max(LIMITS.rows),
  delimiter: z.string(),
  csv: z.string(),
  profiles: z.array(
    z.object({
      missing: z.number(),
      unique: z.number(),
      numeric: z.boolean(),
      values: z.array(z.string()),
    }),
  ),
});
export type Dataset = z.infer<typeof datasetSchema>;
export function emptyProject(): Project {
  return {
    schemaVersion: 2,
    id: crypto.randomUUID(),
    name: "Untitled network",
    variables: [],
    edges: [],
    cpts: [],
    evidence: {},
    queryGroups: [],
    missingTokens: [""],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
export function parents(p: Project, id: string) {
  return p.edges
    .filter((e) => e.target === id)
    .map((e) => e.source)
    .sort();
}
export function signature(p: Project, id: string) {
  return JSON.stringify([
    id,
    p.variables.find((v) => v.id === id)?.states,
    parents(p, id).map((x) => [x, p.variables.find((v) => v.id === x)?.states]),
    p.variables.find((v) => v.id === id)?.parameterMode,
  ]);
}
export function cyclicNodes(p: Project): string[] {
  // Strongly connected components: include every cyclic component, not descendants.
  let index = 0;
  const indices = new Map<string, number>(),
    low = new Map<string, number>(),
    stack: string[] = [],
    on = new Set<string>(),
    bad: string[] = [];
  function visit(id: string) {
    indices.set(id, index);
    low.set(id, index++);
    stack.push(id);
    on.add(id);
    for (const e of p.edges.filter((e) => e.source === id)) {
      if (!indices.has(e.target)) {
        visit(e.target);
        low.set(id, Math.min(low.get(id)!, low.get(e.target)!));
      } else if (on.has(e.target))
        low.set(id, Math.min(low.get(id)!, indices.get(e.target)!));
    }
    if (low.get(id) === indices.get(id)) {
      const component: string[] = [];
      let x;
      do {
        x = stack.pop()!;
        on.delete(x);
        component.push(x);
      } while (x !== id);
      if (
        component.length > 1 ||
        p.edges.some((e) => e.source === id && e.target === id)
      )
        bad.push(...component);
    }
  }
  p.variables.forEach((v) => {
    if (!indices.has(v.id)) visit(v.id);
  });
  return bad;
}
export function cptSize(p: Project, id: string) {
  let n = p.variables.find((v) => v.id === id)!.states.length;
  for (const parent of parents(p, id)) {
    n *= p.variables.find((v) => v.id === parent)!.states.length;
    if (n > LIMITS.cptCells)
      throw new ModelError(
        "RESOURCE_LIMIT",
        "CPT exceeds 1,000,000 cells. Reduce parents or states.",
      );
  }
  return n;
}
export function defaultStateLabels(states: string[]): string[] {
  const seen = new Set<string>();
  return states.map((state, i) => {
    const base = state.trim().slice(0, 200) || `State ${i + 1}`;
    let label = base,
      n = 2;
    while (seen.has(label)) {
      const suffix = ` (${n++})`;
      label = base.slice(0, 200 - suffix.length) + suffix;
    }
    seen.add(label);
    return label;
  });
}
export function validateProject(input: unknown): Project {
  if (
    input &&
    typeof input === "object" &&
    "schemaVersion" in input &&
    input.schemaVersion === 1
  ) {
    const old = validateV1(input);
    const migrated: Project = {
      ...old,
      schemaVersion: 2,
      variables: old.variables.map((v) => ({
        ...v,
        stateLabels: defaultStateLabels(v.states),
        displayDecimals: 2,
        parameterMode: "learned",
      })),
      queryGroups: old.targetIds.map((id) => ({
        id: crypto.randomUUID(),
        name:
          old.variables
            .find((v) => v.id === id)!
            .label.trim()
            .slice(0, 100) || "Query",
        targetIds: [id],
      })),
    };
    for (const c of migrated.cpts)
      c.signature = signature(migrated, c.variableId);
    return validateProject(migrated);
  }
  const p = projectSchema.parse(input),
    ids = new Set(p.variables.map((v) => v.id));
  if (ids.size !== p.variables.length)
    throw new Error("Duplicate variable IDs.");
  if (new Set(p.queryGroups.map((g) => g.id)).size !== p.queryGroups.length)
    throw new Error("Duplicate query group IDs.");
  for (const g of p.queryGroups)
    if (
      new Set(g.targetIds).size !== g.targetIds.length ||
      g.targetIds.some((id) => !ids.has(id))
    )
      throw new Error("Invalid query group targets.");
  for (const v of p.variables) {
    if (
      v.stateLabels.length !== v.states.length ||
      new Set(v.stateLabels).size !== v.stateLabels.length
    )
      throw new Error("State display names must be nonblank and unique.");
    if (
      v.representation === "finiteNumeric" &&
      v.states.some(
        (s, i) =>
          !Number.isFinite(Number(s)) ||
          String(Number(s)) !== s ||
          (i > 0 && Number(s) <= Number(v.states[i - 1])),
      )
    )
      throw new Error(
        "Finite numeric states must be canonical numbers in increasing order.",
      );
    if (v.binning && v.binning.fittedRange[0] > v.binning.fittedRange[1])
      throw new Error("Invalid fitted numeric range.");
    if (new Set(v.states).size !== v.states.length)
      throw new Error("Duplicate states.");
    if (
      v.representation === "discretised" &&
      (!v.binning || v.states.length !== v.binning.cuts.length + 1)
    )
      throw new Error("Invalid discretisation states.");
    if (v.binning?.cuts.some((x, i, a) => i > 0 && x <= a[i - 1]))
      throw new Error("Bin cuts must increase strictly.");
    if (p.dataset && Number(v.columnId.slice(1)) >= p.dataset.headers.length)
      throw new Error(
        "Source column does not exist in the dataset descriptor.",
      );
    if (!/^c\d+$/.test(v.columnId))
      throw new Error("Invalid source column ID.");
  }
  if (new Set(p.edges.map((e) => e.id)).size !== p.edges.length)
    throw new Error("Duplicate edge IDs.");
  const seen = new Set<string>();
  for (const e of p.edges) {
    const key = `${e.source}:${e.target}`;
    if (
      !ids.has(e.source) ||
      !ids.has(e.target) ||
      e.source === e.target ||
      seen.has(key)
    )
      throw new Error("Invalid, self or duplicate edge.");
    seen.add(key);
  }
  let total = 0;
  for (const c of p.cpts) total += c.values.length;
  if (total > LIMITS.totalCells)
    throw new ModelError(
      "RESOURCE_LIMIT",
      "Model exceeds 5,000,000 CPT cells.",
    );
  const cpts = new Set<string>();
  for (const c of p.cpts) {
    const v = p.variables.find((v) => v.id === c.variableId);
    if (
      !v ||
      (v.parameterMode === "uniform") !== (c.origin === "uniform") ||
      cpts.has(c.variableId) ||
      c.signature !== signature(p, c.variableId) ||
      JSON.stringify(c.parentIds) !==
        JSON.stringify(parents(p, c.variableId)) ||
      c.values.length !== cptSize(p, c.variableId) ||
      c.counts.length !== c.values.length ||
      c.rowCounts.length !== c.values.length / v.states.length
    )
      throw new Error("Invalid or outdated CPT shape/signature.");
    cpts.add(c.variableId);
    for (let i = 0; i < c.values.length; i += v.states.length) {
      const row = c.values.slice(i, i + v.states.length);
      if (
        c.origin === "uniform" &&
        row.some((x) => Math.abs(x - 1 / v.states.length) > 1e-12)
      )
        throw new Error("Uniform CPT rows must have equal probabilities.");
      if (
        row.some((x) => x < 0 || x > 1) ||
        Math.abs(row.reduce((a, b) => a + b, 0) - 1) > 1e-9
      )
        throw new Error("CPT probabilities must sum to 1.");
    }
  }
  for (const [id, state] of Object.entries(p.evidence))
    if (
      !ids.has(id) ||
      state >= p.variables.find((v) => v.id === id)!.states.length
    )
      throw new Error("Unknown evidence state.");

  return p;
}
export function inferenceReady(p: Project) {
  if (!p.variables.length)
    throw new ModelError("INVALID_GRAPH", "Add variables first.");
  if (cyclicNodes(p).length)
    throw new ModelError(
      "INVALID_GRAPH",
      "Resolve the highlighted cycle before training or inference.",
    );
  if (
    p.cpts.length !== p.variables.length ||
    p.cpts.some((c) => c.signature !== signature(p, c.variableId))
  )
    throw new ModelError(
      "INVALID_CPT",
      "Train CPTs for the current model before inference.",
    );
}
export function invalidate(p: Project) {
  p.cpts = p.cpts.filter(
    (c) =>
      c.signature === signature(p, c.variableId) &&
      p.variables.some((v) => v.id === c.variableId),
  );
}

export function stateLabel(v: Variable, index: number): string {
  if (v.representation !== "discretised") return v.stateLabels[index];
  const cuts = v.binning!.cuts,
    n = v.displayDecimals;
  const format = (x: number) => x.toFixed(n);
  return `${index === 0 ? "(−∞" : `[${format(cuts[index - 1])}`}, ${index === cuts.length ? "+∞" : format(cuts[index])})`;
}
export function precisionWarning(v: Variable): boolean {
  if (!v.binning) return false;
  const labels = v.binning.cuts.map((x) => x.toFixed(v.displayDecimals));
  return new Set(labels).size < labels.length;
}
