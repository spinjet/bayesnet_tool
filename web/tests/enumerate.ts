import type { EngineModel } from "../src/engine";
export function enumerate(
  model: EngineModel,
  evidence: Record<string, number>,
) {
  const marginals = Object.fromEntries(
    model.variables.map((v) => [v.id, Array(v.states.length).fill(0)]),
  );
  let total = 0;
  function visit(i: number, assignment: Record<string, number>) {
    if (i < model.variables.length) {
      const v = model.variables[i];
      for (let k = 0; k < v.states.length; k++)
        if (evidence[v.id] === undefined || evidence[v.id] === k)
          visit(i + 1, { ...assignment, [v.id]: k });
      return;
    }
    let p = 1;
    for (const c of model.cpts) {
      let row = 0;
      for (const id of c.parentIds)
        row =
          row * model.variables.find((v) => v.id === id)!.states.length +
          assignment[id];
      const r = model.variables.find((v) => v.id === c.variableId)!.states
        .length;
      p *= c.values[row * r + assignment[c.variableId]];
    }
    total += p;
    for (const v of model.variables) marginals[v.id][assignment[v.id]] += p;
  }
  visit(0, {});
  if (total === 0) throw new Error("Impossible evidence");
  for (const v of Object.values(marginals))
    v.forEach((p, i) => (v[i] = p / total));
  return marginals;
}

export function enumerateJoint(
  model: EngineModel,
  evidence: Record<string, number>,
  targets: string[],
) {
  const shape = targets.map(
      (id) => model.variables.find((v) => v.id === id)!.states.length,
    ),
    values = Array(shape.reduce((a, b) => a * b, 1)).fill(0);
  let total = 0;
  function visit(i: number, assignment: Record<string, number>) {
    if (i < model.variables.length) {
      const v = model.variables[i];
      for (let k = 0; k < v.states.length; k++)
        if (evidence[v.id] === undefined || evidence[v.id] === k)
          visit(i + 1, { ...assignment, [v.id]: k });
      return;
    }
    let weight = 1;
    for (const c of model.cpts) {
      let row = 0;
      for (const parent of c.parentIds)
        row =
          row * model.variables.find((v) => v.id === parent)!.states.length +
          assignment[parent];
      weight *=
        c.values[
          row *
            model.variables.find((v) => v.id === c.variableId)!.states.length +
            assignment[c.variableId]
        ];
    }
    let index = 0;
    targets.forEach((id, j) => (index = index * shape[j] + assignment[id]));
    values[index] += weight;
    total += weight;
  }
  visit(0, {});
  return values.map((p) => p / total);
}
