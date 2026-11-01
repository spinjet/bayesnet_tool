import Papa from "papaparse";
import {
  LIMITS,
  cyclicNodes,
  cptSize,
  parents,
  signature,
  type Dataset,
  type Project,
  type Variable,
  type Cpt,
} from "./domain";
import { ModelError } from "./engine";
export async function parseCsv(
  csv: string,
  name: string,
  delimiter: string,
  tokens: string[],
): Promise<Dataset> {
  if (new TextEncoder().encode(csv).length > LIMITS.fileBytes)
    throw new ModelError("RESOURCE_LIMIT", "CSV exceeds 100 MiB.");
  const parsed = Papa.parse<string[]>(csv.replace(/^\uFEFF/, ""), {
    delimiter,
    skipEmptyLines: "greedy",
  });
  if (parsed.errors.length)
    throw new ModelError(
      "DATA_PARSE_ERROR",
      parsed.errors.map((e) => e.message).join("; "),
    );
  const [headers, ...rows] = parsed.data;
  if (
    !headers?.length ||
    headers.some((h) => !h.trim()) ||
    new Set(headers).size !== headers.length
  )
    throw new ModelError(
      "DATA_PARSE_ERROR",
      "Headers must be nonblank and unique.",
    );
  if (!rows.length)
    throw new ModelError("EMPTY_DATASET", "CSV has no data rows.");
  if (headers.length > LIMITS.columns || rows.length > LIMITS.rows)
    throw new ModelError(
      "RESOURCE_LIMIT",
      "CSV exceeds 500 columns or 1,000,000 rows.",
    );
  if (rows.some((r) => r.length !== headers.length))
    throw new ModelError(
      "DATA_PARSE_ERROR",
      "Every row must have the same number of fields as the header.",
    );
  const profiles = headers.map((_, i) => {
    const values = rows.map((r) => r[i]).filter((v) => !tokens.includes(v));
    const unique = [...new Set(values)].sort();
    return {
      missing: rows.length - values.length,
      unique: unique.length,
      numeric:
        values.length > 0 &&
        values.every((v) => v.trim() !== "" && Number.isFinite(Number(v))),
      values: unique.slice(0, 65),
    };
  });
  const hash = [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(csv)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  return {
    csv,
    name,
    headers,
    rows,
    delimiter: parsed.meta.delimiter,
    hash,
    profiles,
  };
}
export function cutsFor(
  values: number[],
  method: "manual" | "equalWidth" | "quantile",
  bins: number,
  manual: number[] = [],
): number[] {
  if (!Number.isInteger(bins) || bins < 2 || bins > 64)
    throw new Error("Choose 2–64 bins.");
  if (!values.length || values.some((x) => !Number.isFinite(x)))
    throw new Error("No valid finite numeric data.");
  let cuts: number[];
  if (method === "manual") {
    cuts = manual;
    if (
      !cuts.length ||
      cuts.length > 63 ||
      cuts.some((x, i) => !Number.isFinite(x) || (i > 0 && x <= cuts[i - 1]))
    )
      throw new Error("Enter 1–63 strictly increasing finite thresholds.");
  } else {
    const sorted = [...values].sort((a, b) => a - b),
      min = sorted[0],
      max = sorted.at(-1)!;
    if (min === max)
      throw new Error(
        "Constant numeric columns cannot form multiple bins. Exclude this variable.",
      );
    cuts = Array.from({ length: bins - 1 }, (_, i) => {
      if (method === "equalWidth") return min + ((max - min) * (i + 1)) / bins;
      const at = ((sorted.length - 1) * (i + 1)) / bins,
        lo = Math.floor(at);
      return sorted[lo] + (sorted[Math.ceil(at)] - sorted[lo]) * (at - lo);
    });
    cuts = [...new Set(cuts)];
  }
  if (!cuts.length)
    throw new Error(
      "These cuts produce fewer than two effective states. Reduce bins or exclude the column.",
    );
  return cuts;
}
export function encode(v: Variable, raw: string): number {
  if (v.representation === "discretised") {
    if (!raw.trim() || !Number.isFinite(Number(raw)))
      throw new Error(`Invalid numeric value in ${v.label}: ${raw}`);
    const n = Number(raw);
    return v.binning!.cuts.filter((c) => n >= c).length;
  }
  const value =
    v.representation === "finiteNumeric" ? String(Number(raw)) : raw;
  if (
    v.representation === "finiteNumeric" &&
    (!raw.trim() || !Number.isFinite(Number(raw)))
  )
    throw new Error(`Invalid numeric value in ${v.label}.`);
  const state = v.states.indexOf(value);
  if (state < 0) throw new Error(`Unknown state in ${v.label}: ${raw}`);
  return state;
}
export function configureVariable(
  dataset: Dataset,
  p: Project,
  columnId: string,
  representation: Variable["representation"],
  method: "manual" | "equalWidth" | "quantile",
  bins: number,
  manual: number[],
): Variable {
  const index = Number(columnId.slice(1));
  if (!dataset.headers[index]) throw new Error("Source column not found.");
  const raw = dataset.rows
    .map((r) => r[index])
    .filter((v) => !p.missingTokens.includes(v));
  const existing = p.variables.find((v) => v.columnId === columnId);
  const v: Variable = {
    id: existing?.id || crypto.randomUUID(),
    label: existing?.label || dataset.headers[index],
    columnId,
    representation,
    states: [],
    position: existing?.position || {
      x: 80 + (p.variables.length % 3) * 230,
      y: 80 + Math.floor(p.variables.length / 3) * 160,
    },
  };
  if (representation === "discretised") {
    if (raw.some((x) => !x.trim() || !Number.isFinite(Number(x))))
      throw new Error("Column contains invalid numeric values.");
    const values = raw.map(Number),
      cuts = cutsFor(values, method, bins, manual);
    let min = Infinity,
      max = -Infinity;
    for (const n of values) {
      min = Math.min(min, n);
      max = Math.max(max, n);
    }
    v.binning = {
      method,
      cuts,
      requestedBins: method === "manual" ? cuts.length + 1 : bins,
      fittedRange: [min, max],
      algorithmVersion: "1",
      closure: "leftClosed",
    };
    v.states = Array.from(
      { length: cuts.length + 1 },
      (_, i) =>
        `${i === 0 ? "(−∞" : `[${cuts[i - 1]}`}, ${i === cuts.length ? "+∞" : cuts[i]})`,
    );
  } else {
    if (
      representation === "finiteNumeric" &&
      raw.some((x) => !x.trim() || !Number.isFinite(Number(x)))
    )
      throw new Error("Column contains invalid numeric values.");
    v.states = [
      ...new Set(
        raw.map((x) =>
          representation === "finiteNumeric" ? String(Number(x)) : x,
        ),
      ),
    ].sort(
      representation === "finiteNumeric"
        ? (a, b) => Number(a) - Number(b)
        : undefined,
    );
  }
  if (v.states.length < 2 || v.states.length > LIMITS.states)
    throw new Error(
      "Variables need 2–64 states. Discretise high-cardinality numeric columns; exclude constant columns.",
    );
  return v;
}
export function prepareRows(dataset: Dataset, p: Project) {
  const indices = p.variables.map((v) => Number(v.columnId.slice(1)));
  const retained = dataset.rows.filter((row) =>
    indices.every((i) => !p.missingTokens.includes(row[i])),
  );
  if (!retained.length)
    throw new ModelError(
      "EMPTY_DATASET",
      "No complete records remain for the selected model variables.",
    );
  return {
    encoded: retained.map((row) =>
      p.variables.map((v, i) => encode(v, row[indices[i]])),
    ),
    retained: retained.length,
    dropped: dataset.rows.length - retained.length,
  };
}
export function train(
  dataset: Dataset,
  p: Project,
  method: "mle" | "dirichlet",
  alpha: number,
) {
  if (!p.variables.length) throw new Error("Add variables first.");
  if (cyclicNodes(p).length)
    throw new ModelError(
      "INVALID_GRAPH",
      "Resolve the highlighted cycle before training.",
    );
  if (method === "dirichlet" && (!Number.isFinite(alpha) || alpha <= 0))
    throw new Error("Dirichlet α must be positive and finite.");
  const sizes = p.variables.map((v) => cptSize(p, v.id));
  if (sizes.reduce((a, b) => a + b, 0) > LIMITS.totalCells)
    throw new ModelError("RESOURCE_LIMIT", "Total CPT cells exceed 5,000,000.");
  const prepared = prepareRows(dataset, p),
    a = method === "mle" ? 0 : alpha;
  const cpts: Cpt[] = p.variables.map((v, vi) => {
    const parentIds = parents(p, v.id),
      pi = parentIds.map((id) => p.variables.findIndex((x) => x.id === id)),
      r = v.states.length;
    const counts = Array(sizes[vi]).fill(0),
      rowCounts = Array(sizes[vi] / r).fill(0);
    for (const row of prepared.encoded) {
      let j = 0;
      pi.forEach((i) => {
        j = j * p.variables[i].states.length + row[i];
      });
      counts[j * r + row[vi]]++;
      rowCounts[j]++;
    }
    if (method === "mle" && rowCounts.includes(0))
      throw new ModelError(
        "UNOBSERVED_PARENT_CONFIGURATION",
        `${v.label} has unobserved parent combinations. Retrain with Dirichlet smoothing.`,
      );
    return {
      variableId: v.id,
      parentIds,
      counts,
      rowCounts,
      values: counts.map(
        (n, i) => (n + a) / (rowCounts[Math.floor(i / r)] + r * a),
      ),
      signature: signature(p, v.id),
      origin: method,
      alphaPerCell: a,
      datasetHash: dataset.hash,
      trainedAt: new Date().toISOString(),
    };
  });
  return { cpts, retained: prepared.retained, dropped: prepared.dropped };
}
