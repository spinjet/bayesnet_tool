import { instance } from "@viz-js/viz";
import { stateLabel, evidenceLabel, type Project } from "./domain";
let renderer: ReturnType<typeof instance> | undefined;
export function graphDot(
  p: Project,
  posterior?: Record<string, number[]>,
): string {
  const port = { left: "w", right: "e", top: "n", bottom: "s" };
  const ids = new Map(p.variables.map((v, i) => [v.id, `n${i}`]));
  const lines = [
    "digraph PDOPT_BN {",
    'graph [rankdir=LR, bgcolor="white", pad="0.25", nodesep="0.45", ranksep="0.8"];',
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
) {
  if (!p.variables.length)
    throw new Error("Add variables before exporting a network image.");
  const viz = await (renderer ??= instance());
  let svg = viz.renderString(graphDot(p, posterior), {
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
