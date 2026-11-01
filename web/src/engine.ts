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
export type Evidence = Record<string, number>;
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
) {
  // A fresh native model prevents retained evidence and stale native CPTs.
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
    // The beta binding does not diagnose impossible evidence. Validate each
    // conditional factor P(e_i | e_1..e_(i-1)) before adding that assignment.
    for (const [id, state] of Object.entries(evidence)) {
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
    return { prior, posterior };
  } finally {
    bn.destroy();
  }
}
