import type { Project } from "./domain";
import { stateLabel } from "./domain";
import type { JointResult } from "./engine";
import { nextDown } from "./numbers";
import { csvCell } from "./files";
import { zipSync, strToU8 } from "fflate";
export interface SampleOptions {
  count: number;
  seed: number;
  bounds: Record<string, { min: number; max: number }>;
}
/** Versioned deterministic generator; not for security or encryption. */
export function randomGenerator(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function sampleArchive(
  project: Project,
  groupId: string,
  joint: JointResult,
  options: SampleOptions,
) {
  const { count, seed, bounds } = options;
  if (!Number.isInteger(count) || count < 1 || count > 100000)
    throw new Error("Choose 1–100,000 samples.");
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295)
    throw new Error("Seed must be an integer from 0 to 4,294,967,295.");
  const group = project.queryGroups.find((g) => g.id === groupId);
  if (
    !group ||
    JSON.stringify(joint.targetIds) !== JSON.stringify(group.targetIds)
  )
    throw new Error("Query targets do not match the current distribution.");
  const vars = joint.targetIds.map((id) =>
    project.variables.find((v) => v.id === id)!,
  );
  const size = vars.reduce((n, v) => n * v.states.length, 1);
  if (
    joint.shape.length !== vars.length ||
    joint.posterior.length !== size ||
    joint.shape.some((n, i) => n !== vars[i].states.length) ||
    joint.posterior.some((p) => !Number.isFinite(p) || p < 0 || p > 1) ||
    Math.abs(joint.posterior.reduce((a, b) => a + b, 0) - 1) > 1e-9
  )
    throw new Error("Invalid joint distribution.");
  const positive = vars.map((v) => Array(v.states.length).fill(false));
  const assignments = joint.posterior.map((p, index) => {
    let rest = index;
    const states = Array(vars.length).fill(0);
    for (let i = vars.length - 1; i >= 0; i--) {
      states[i] = rest % joint.shape[i];
      rest = Math.floor(rest / joint.shape[i]);
      if (p > 0) positive[i][states[i]] = true;
    }
    return states;
  });
  const intervals = vars.map((v, i) => {
    if (v.representation !== "discretised") return null;
    const b = bounds[v.id] || {
      min: v.binning!.fittedRange[0],
      max: v.binning!.fittedRange[1],
    };
    if (!Number.isFinite(b.min) || !Number.isFinite(b.max) || b.min >= b.max)
      throw new Error(`Set finite lower < upper bounds for ${v.label}.`);
    return v.states.map((_, k) => {
      const lo = Math.max(b.min, k === 0 ? -Infinity : v.binning!.cuts[k - 1]);
      const binHi = k === v.states.length - 1 ? Infinity : v.binning!.cuts[k];
      const hi = Math.min(b.max, binHi);
      const max = hi === binHi ? nextDown(hi) : hi;
      if (
        positive[i][k] &&
        (lo > max || !Number.isFinite(lo) || !Number.isFinite(max))
      )
        throw new Error(
          `Sampling bounds exclude a positive-probability state of ${v.label}. Expand the bounds.`,
        );
      return { min: lo, max };
    });
  });
  const rng = randomGenerator(seed),
    cdf: number[] = [];
  let sum = 0;
  joint.posterior.forEach((p) => {
    sum += p;
    cdf.push(sum);
  });
  const names: string[] = [],
    seen = new Set<string>();
  for (const v of vars) {
    let name = v.label,
      n = 2;
    while (seen.has(name)) name = `${v.label} (${n++})`;
    seen.add(name);
    names.push(name);
  }
  const rows = [names.map(csvCell).join(",")];
  let bytes = rows[0].length;
  for (let row = 0; row < count; row++) {
    const u = rng() * sum;
    let lo = 0,
      hi = cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (u < cdf[mid]) hi = mid;
      else lo = mid + 1;
    }
    const values = vars.map((v, i) => {
      const state = assignments[lo][i];
      if (v.representation === "categorical") return stateLabel(v, state);
      if (v.representation === "finiteNumeric") return Number(v.states[state]);
      return 0;
    });
    // Numeric draws are independent within bins, conditional on the jointly drawn states.
    vars.forEach((v, i) => {
      if (v.representation === "discretised") {
        const range = intervals[i]![assignments[lo][i]],
          u = rng();
        values[i] = Math.max(
          range.min,
          Math.min(range.max, range.min * (1 - u) + range.max * u),
        );
      }
    });
    const line = values.map(csvCell).join(",");
    bytes += new TextEncoder().encode(line).length + 2;
    if (bytes > 100 * 1024 * 1024)
      throw new Error("Sample CSV exceeds 100 MiB. Reduce the sample count.");
    rows.push(line);
  }
  const manifest = {
    formatVersion: 1,
    sampler: "joint-cdf/mulberry32-v1",
    count,
    seed,
    query: group,
    projectId: project.id,
    projectUpdatedAt: project.updatedAt,
    evidence: project.evidence,
    columns: vars.map((v, i) => ({
      header: names[i],
      variableId: v.id,
      representation: v.representation,
      states: v.states.map((source, k) => ({
        stateId: k,
        source,
        label: stateLabel(v, k),
      })),
      binning: v.binning,
      samplingBounds: v.binning
        ? bounds[v.id] || {
            min: v.binning.fittedRange[0],
            max: v.binning.fittedRange[1],
          }
        : undefined,
    })),
    distribution: { shape: joint.shape, posterior: joint.posterior },
    datasetHash: project.dataset?.hash,
    training: project.cpts.map((c) => ({
      variableId: c.variableId,
      origin: c.origin,
      alphaPerCell: c.alphaPerCell,
      trainedAt: c.trainedAt,
    })),
    notes:
      "State combinations follow the joint posterior. Numeric values assume independent uniform distributions within finite bin/bound intersections; this is not a learned continuous density.",
  };
  const archive = zipSync(
    {
      "samples.csv": strToU8(rows.join("\r\n")),
      "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
    },
    { level: 6, mtime: new Date("1980-01-01T00:00:00Z") },
  );
  return { archive, count };
}
