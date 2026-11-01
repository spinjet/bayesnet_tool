import type { BayesNet } from "jsagrum";
export interface EngineVariable {
  id: string;
  states: string[];
}
export interface EngineCpt {
  variableId: string;
  parentIds: string[];
  values: number[];
}
export interface EngineModel {
  variables: EngineVariable[];
  cpts: EngineCpt[];
}
export interface QueryGroup {
  id: string;
  name?: string;
  targetIds: string[];
}
export interface JointResult {
  targetIds: string[];
  shape: number[];
  prior: number[];
  posterior: number[];
}
export const QUERY_LIMITS = { perGroup: 4096, total: 8192, groups: 10 };
export function querySize(
  variables: EngineVariable[],
  group: QueryGroup,
): number {
  return group.targetIds.reduce(
    (n, id) => n * (variables.find((v) => v.id === id)?.states.length ?? 0),
    1,
  );
}
export function validateQueries(
  variables: EngineVariable[],
  groups: QueryGroup[],
) {
  if (new Set(groups.map((g) => g.id)).size !== groups.length)
    throw new ModelError("INVALID_QUERY", "Query group IDs must be unique.");
  if (groups.length > QUERY_LIMITS.groups)
    throw new ModelError("RESOURCE_LIMIT", "Use at most 10 query groups.");
  let total = 0;
  for (const group of groups) {
    if (
      !group.targetIds.length ||
      new Set(group.targetIds).size !== group.targetIds.length ||
      group.targetIds.some((id) => !variables.some((v) => v.id === id))
    )
      throw new ModelError(
        "INVALID_QUERY",
        "Each query group needs distinct, existing target variables.",
      );
    const size = querySize(variables, group);
    total += size;
    if (size > QUERY_LIMITS.perGroup)
      throw new ModelError(
        "RESOURCE_LIMIT",
        `${group.name || "Query"} has ${size.toLocaleString()} combinations. Limit: 4,096 per group.`,
      );
  }
  if (total > QUERY_LIMITS.total)
    throw new ModelError(
      "RESOURCE_LIMIT",
      "Queries exceed 8,192 total combinations.",
    );
}
export type Evidence = Record<string, number | number[]>;
type HardEvidence = Record<string, number>;
export class ModelError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
function distribution(p: number[]) {
  if (
    !p.length ||
    p.some((x) => !Number.isFinite(x) || x < 0 || x > 1) ||
    Math.abs(p.reduce((a, b) => a + b, 0) - 1) > 1e-9
  )
    throw new ModelError(
      "ENGINE_FAILURE",
      "The engine returned an invalid distribution.",
    );
  return p;
}
export async function infer(
  model: EngineModel,
  evidence: Evidence,
  targets: string[],
  create: () => Promise<BayesNet>,
  groups: QueryGroup[] = [],
) {
  // A fresh native model prevents retained evidence and stale native CPTs.
  validateQueries(model.variables, groups);
  // A deterministic indicator leaf turns a set-valued event into exact hard
  // evidence. It is disposable and never enters the saved/displayed graph.
  const hard: HardEvidence = {};
  const variables = [...model.variables],
    cpts = [...model.cpts];
  for (const [id, value] of Object.entries(evidence)) {
    const v = variables.find((v) => v.id === id);
    if (!v) throw new ModelError("UNKNOWN_STATE", "Unknown evidence variable.");
    const states = typeof value === "number" ? [value] : value;
    if (!states.length)
      throw new ModelError(
        "IMPOSSIBLE_EVIDENCE",
        "Evidence permits no states.",
      );
    if (
      new Set(states).size !== states.length ||
      states.some((k) => !Number.isInteger(k) || k < 0 || k >= v.states.length)
    )
      throw new ModelError(
        "UNKNOWN_STATE",
        "Unknown or duplicate evidence states.",
      );
    if (states.length === 1) {
      hard[id] = states[0];
      continue;
    }
    if (states.length === v.states.length) continue;
    let aux = `__event_${variables.length}`;
    while (variables.some((v) => v.id === aux)) aux += "_";
    variables.push({ id: aux, states: ["false", "true"] });
    cpts.push({
      variableId: aux,
      parentIds: [id],
      values: v.states.flatMap((_, i) =>
        states.includes(i) ? [0, 1] : [1, 0],
      ),
    });
    hard[aux] = 1;
  }
  model = { variables, cpts };
  const bn = await create();
  try {
    const ids = new Map<string, number>();
    for (const v of model.variables) {
      if (v.states.length < 2)
        throw new ModelError(
          "UNSUPPORTED_CAPABILITY",
          "Inference requires at least two states per variable. Exclude constant columns.",
        );
      ids.set(
        v.id,
        await bn.addNode(
          `v${ids.size}`,
          v.states.map((_, i) => `s${i}`),
        ),
      );
    }
    for (const c of model.cpts)
      for (const parent of c.parentIds)
        await bn.addArc(ids.get(parent)!, ids.get(c.variableId)!);
    for (const c of model.cpts) {
      const child = ids.get(c.variableId)!;
      const detailed = await bn.getDetailedCPT(child);
      const actual = detailed.parents.map(
        (p) => [...ids].find(([, id]) => id === p.id)![0],
      );
      // Canonical child-fastest, last parent fastest; engine axes read back explicitly.
      const cards = c.parentIds.map(
        (id) => model.variables.find((v) => v.id === id)!.states.length,
      );
      const r = model.variables.find((v) => v.id === c.variableId)!.states
        .length;
      const output = new Array(c.values.length);
      for (let row = 0; row < c.values.length / r; row++) {
        let rem = row;
        const assignment: Record<string, number> = {};
        for (const parent of actual) {
          const card = model.variables.find((v) => v.id === parent)!.states
            .length;
          assignment[parent] = rem % card;
          rem = Math.floor(rem / card);
        }
        let canonical = 0;
        c.parentIds.forEach((p, i) => {
          canonical = canonical * cards[i] + assignment[p];
        });
        for (let k = 0; k < r; k++)
          output[row * r + k] = c.values[canonical * r + k];
      }
      await bn.setCPT(child, output);
    }
    await bn.addAllTargets();
    await bn.computeInference();
    const prior: Record<string, number[]> = {};
    for (const id of targets)
      prior[id] = distribution(await bn.getPosterior(ids.get(id)!));
    // Enumerate target prefixes with exact conditional probabilities. The last
    // target varies fastest. A prefix is inferred once, not once per leaf.
    async function joint(group: QueryGroup, base: HardEvidence) {
      const shape = group.targetIds.map(
        (id) => model.variables.find((v) => v.id === id)!.states.length,
      );
      const values = Array(querySize(model.variables, group)).fill(0);
      async function visit(
        depth: number,
        weight: number,
        index: number,
      ): Promise<void> {
        if (depth === shape.length) {
          values[index] = weight;
          return;
        }
        const id = group.targetIds[depth],
          card = shape[depth];
        if (base[id] !== undefined) {
          await visit(depth + 1, weight, index * card + base[id]);
          return;
        }
        const conditional = distribution(await bn.getPosterior(ids.get(id)!));
        for (let state = 0; state < card; state++) {
          if (conditional[state] === 0) continue;
          const next = weight * conditional[state];
          if (next === 0 && weight > 0)
            throw new ModelError(
              "ENGINE_FAILURE",
              "Joint probability underflow. Reduce the query size.",
            );
          if (depth === shape.length - 1) {
            values[index * card + state] = next;
            continue;
          }
          await bn.addEvidence(ids.get(id)!, state);
          try {
            await bn.computeInference();
            await visit(depth + 1, next, index * card + state);
          } finally {
            await bn.eraseEvidence(ids.get(id)!);
            await bn.computeInference();
          }
        }
      }
      await visit(0, 1, 0);
      return distribution(values);
    }
    const joints: Record<string, JointResult> = Object.create(null);
    for (const g of groups)
      joints[g.id] = {
        targetIds: [...g.targetIds],
        shape: g.targetIds.map(
          (id) => model.variables.find((v) => v.id === id)!.states.length,
        ),
        prior: await joint(g, {}),
        posterior: [],
      };
    // The beta binding does not diagnose impossible evidence. Validate each
    // conditional factor P(e_i | e_1..e_(i-1)) before adding that assignment.
    for (const [id, state] of Object.entries(hard)) {
      const p = distribution(await bn.getPosterior(ids.get(id)!));
      if (p[state] === 0)
        throw new ModelError(
          "IMPOSSIBLE_EVIDENCE",
          "The selected evidence has zero probability under this model.",
        );
      if (p[state] === undefined)
        throw new ModelError("UNKNOWN_STATE", "Evidence state does not exist.");
      await bn.addEvidence(ids.get(id)!, state);
      await bn.computeInference();
    }
    const posterior: Record<string, number[]> = {};
    for (const id of targets)
      posterior[id] = distribution(await bn.getPosterior(ids.get(id)!));
    for (const g of groups) joints[g.id].posterior = await joint(g, hard);
    return { prior, posterior, groups: joints };
  } finally {
    bn.destroy();
  }
}
