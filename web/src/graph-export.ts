import { instance } from "@viz-js/viz";
import { stateLabel, evidenceLabel, type Project } from "./domain";
export type GraphDirection = "auto" | "TB" | "BT" | "LR" | "RL";
/** Graphviz has one hierarchy axis; mixed sides vote for its dominant flow. */
export function graphDirection(
  p: Project,
  requested: GraphDirection = "auto",
): Exclude<GraphDirection, "auto"> {
  if (requested !== "auto") return requested;
  if (!p.edges.length) return "LR";
  const votes = { TB: 0, BT: 0, LR: 0, RL: 0 };
  const outgoing = {
    bottom: "TB",
    top: "BT",
    right: "LR",
    left: "RL",
  } as const;
  const incoming = {
    top: "TB",
    bottom: "BT",
    left: "LR",
    right: "RL",
  } as const;
  for (const e of p.edges) {
    votes[outgoing[e.sourceHandle || "right"]]++;
    votes[incoming[e.targetHandle || "left"]]++;
  }
  // A stable vertical-first tie break honours top/bottom connections in mixed drafts.
  return (["TB", "BT", "LR", "RL"] as const).reduce(
    (best, direction) => (votes[direction] > votes[best] ? direction : best),
    "TB",
  );
}
let renderer: ReturnType<typeof instance> | undefined;
export function graphDot(
  p: Project,
  posterior?: Record<string, number[]>,
  direction: GraphDirection = "auto",
): string {
  const port = { left: "w", right: "e", top: "n", bottom: "s" };
  const ids = new Map(p.variables.map((v, i) => [v.id, `n${i}`]));
  const lines = [
    "digraph PDOPT_BN {",
    `graph [rankdir=${graphDirection(p, direction)}, splines=polyline, outputorder=edgesfirst, bgcolor="white", pad="0.25", nodesep="0.65", ranksep="1.0"];`,
    'node [shape=box, style="rounded,filled", fillcolor="#edf5f3", color="#487e79", fontname="Arial", fontsize=11];',
    'edge [color="#617985", arrowsize=0.75];',
  ];
  for (const v of p.variables) {
    let label = v.label;
    if (v.parameterMode === "uniform") label += "\nUniform CPT";
    if (p.evidence[v.id] !== undefined)
      label += "\n" + evidenceLabel(v, p.evidence[v.id]);
    if (posterior) {
      const values = posterior[v.id];
      if (!values || values.length !== v.states.length)
        throw new Error("Missing current node probabilities.");
      label +=
        "\n" +
        v.states
          .map(
            (_, k) => `${stateLabel(v, k)}: ${(values[k] * 100).toFixed(3)}%`,
          )
          .join("\n");
    }
    lines.push(`${ids.get(v.id)} [label=${JSON.stringify(label)}];`);
  }
  for (const e of p.edges)
    lines.push(
      `${ids.get(e.source)}:${port[e.sourceHandle || "right"]} -> ${ids.get(e.target)}:${port[e.targetHandle || "left"]};`,
    );
  lines.push("}");
  return lines.join("\n");
}
export async function graphSvg(
  p: Project,
  posterior?: Record<string, number[]>,
  direction: GraphDirection = "auto",
) {
  if (!p.variables.length)
    throw new Error("Add variables before exporting a network image.");
  const viz = await (renderer ??= instance());
  let svg = viz.renderString(graphDot(p, posterior, direction), {
    format: "svg",
    engine: "dot",
  });
  svg = svg.replace(/<!DOCTYPE[\s\S]*?>/, "");
  if (svg.length > 10 * 1024 * 1024)
    throw new Error(
      "Graph image exceeds 10 MiB. Export structure without probabilities.",
    );
  return svg;
}
