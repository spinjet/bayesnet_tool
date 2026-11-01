import { ref, computed } from "vue";
import { defineStore } from "pinia";
import { z } from "zod";
import { ComputeClient } from "./client";
import {
  emptyProject,
  validateProject,
  invalidate,
  cyclicNodes,
  datasetSchema,
  variableSchema,
  cptSchema,
  type Project,
  type Dataset,
  LIMITS,
  thresholdCut,
  type EvidenceValue,
} from "./domain";
const resultSchema = z.object({
  prior: z.record(z.string(), z.array(z.number())),
  posterior: z.record(z.string(), z.array(z.number())),
  groups: z.record(
    z.string(),
    z.object({
      targetIds: z.array(z.string()),
      shape: z.array(z.number().int()),
      prior: z.array(z.number()),
      posterior: z.array(z.number()),
    }),
  ),
});
export const useProject = defineStore("project", () => {
  const project = ref<Project>(emptyProject()),
    dataset = ref<Dataset>(),
    busy = ref(false),
    error = ref(""),
    notice = ref(""),
    dirty = ref(false),
    selected = ref("");
  const revisions = ref({ model: 0, data: 0, query: 0 }),
    results = ref<z.infer<typeof resultSchema>>(),
    resultStamp = ref("");
  const activeTab = ref<"build" | "inference">("build"),
    embedDataset = ref(false);
  const resultSnapshot = ref<Project>();
  const trainingPreview = ref<{
    retained: number;
    dropped: number;
    counts: number[][];
    stamp: string;
  }>();
  const client = new ComputeClient();
  const stamp = () => JSON.stringify(revisions.value);
  const trainingStamp = () =>
    `${revisions.value.model}/${revisions.value.data}`;
  const current = computed(
    () => !!results.value && resultStamp.value === stamp(),
  );
  const cycles = computed(() => cyclicNodes(project.value));
  function touch(kind: "model" | "data" | "query" | "display" = "model") {
    dirty.value = true;
    project.value.updatedAt = new Date().toISOString();
    if (kind !== "display") {
      revisions.value[kind]++;
      if (kind === "data") project.value.cpts = [];
      if (kind === "model") invalidate(project.value);
    }
  }
  async function job<T>(
    op: string,
    payload: unknown,
    parse: (x: unknown) => T,
  ): Promise<T | undefined> {
    if (busy.value) return;
    busy.value = true;
    error.value = "";
    notice.value = "";
    const revision = stamp();
    try {
      const raw = await client.request(op, JSON.parse(JSON.stringify(payload)));
      if (revision !== stamp())
        throw new Error(
          "Discarded an outdated computation. Run it again for the current model.",
        );
      return parse(raw);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return undefined;
    } finally {
      busy.value = false;
    }
  }
  function payload(options?: unknown) {
    return { project: project.value, dataset: dataset.value, options };
  }
  async function importCsv(csv: string, name: string, delimiter = "") {
    const d = await job(
      "import",
      { csv, name, delimiter, tokens: project.value.missingTokens },
      (x) => datasetSchema.parse(x),
    );
    if (!d) return;
    if (
      project.value.variables.length &&
      !confirm(
        "Replace the dataset and clear the current network? Save your project first if needed.",
      )
    )
      return;
    const p = emptyProject();
    p.name = name.replace(/\.csv$/i, "");
    p.missingTokens = [...project.value.missingTokens];
    p.dataset = {
      name: d.name,
      hash: d.hash,
      rowCount: d.rows.length,
      headers: d.headers,
      delimiter: d.delimiter,
    };
    project.value = p;
    dataset.value = d;
    selected.value = "";
    results.value = undefined;
    resultSnapshot.value = undefined;
    resultStamp.value = "";
    touch("data");
    return true;
  }
  async function reattach(csv: string, name: string) {
    const d = await job(
      "import",
      {
        csv,
        name,
        delimiter: project.value.dataset?.delimiter || "",
        tokens: project.value.missingTokens,
      },
      (x) => datasetSchema.parse(x),
    );
    if (!d) return;
    if (d.hash !== project.value.dataset?.hash) {
      error.value =
        "This CSV does not match the saved dataset hash. Your project was preserved.";
      return;
    }
    dataset.value = d;
    notice.value = "Matching dataset reattached.";
  }
  async function configure(
    columnId: string,
    representation: "categorical" | "finiteNumeric" | "discretised",
    method: "manual" | "equalWidth" | "quantile" = "equalWidth",
    bins = 3,
    manual: number[] = [],
  ) {
    if (
      project.value.variables.length >= 100 &&
      !project.value.variables.some((v) => v.columnId === columnId)
    ) {
      error.value = "Maximum 100 variables.";
      return;
    }
    const selectedAtStart = selected.value;
    const v = await job(
      "configure",
      payload({ columnId, representation, method, bins, manual }),
      (x) => variableSchema.parse(x),
    );
    if (!v) return;
    const old = project.value.variables.findIndex((x) => x.id === v.id);
    if (old >= 0) {
      v.label = project.value.variables[old].label;
      v.position = project.value.variables[old].position;
      project.value.variables[old] = v;
      const previous = project.value.evidence[v.id];
      if (
        v.representation === "categorical" ||
        typeof previous !== "object" ||
        previous.kind !== "threshold"
      )
        delete project.value.evidence[v.id];
    } else {
      project.value.variables.push(v);
      if (!project.value.queryGroups.length)
        project.value.queryGroups.push({
          id: crypto.randomUUID(),
          name: v.label.trim().slice(0, 100) || "Query 1",
          targetIds: [v.id],
        });
    }
    if (selected.value === selectedAtStart) selected.value = v.id;
    touch();
  }
  function renameStates(id: string, labels: string[]) {
    const v = project.value.variables.find((v) => v.id === id);
    if (!v) return;
    try {
      const parsed = variableSchema.parse({ ...v, stateLabels: labels });
      if (new Set(parsed.stateLabels).size !== parsed.stateLabels.length)
        throw new Error("State display names must be unique.");
      v.stateLabels = parsed.stateLabels;
      touch("display");
      error.value = "";
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  }
  function setPrecision(id: string, precision: number) {
    if (!Number.isInteger(precision) || precision < 0 || precision > 12) {
      error.value = "Decimal places must be an integer from 0 to 12.";
      return;
    }
    const v = project.value.variables.find((v) => v.id === id);
    if (v) {
      v.displayDecimals = precision;
      touch("display");
      error.value = "";
    }
  }
  function setParameterMode(id: string, mode: "learned" | "uniform") {
    const v = project.value.variables.find((v) => v.id === id);
    if (v && v.parameterMode !== mode) {
      v.parameterMode = mode;
      touch();
    }
  }
  function addGroup() {
    if (project.value.queryGroups.length >= 10) {
      error.value = "Use at most 10 query groups.";
      return;
    }
    const g = {
      id: crypto.randomUUID(),
      name: `Query ${project.value.queryGroups.length + 1}`,
      targetIds: project.value.variables[0]
        ? [project.value.variables[0].id]
        : [],
    };
    project.value.queryGroups.push(g);
    touch("query");
    return g.id;
  }
  function removeGroup(id: string) {
    project.value.queryGroups = project.value.queryGroups.filter(
      (g) => g.id !== id,
    );
    touch("query");
  }
  function addEdge(
    source: string,
    target: string,
    sourceHandle: "left" | "right" | "top" | "bottom" = "right",
    targetHandle: "left" | "right" | "top" | "bottom" = "left",
  ) {
    if (source === target) {
      error.value = "A node cannot connect to itself.";
      return;
    }
    if (
      project.value.edges.some(
        (e) => e.source === source && e.target === target,
      )
    ) {
      error.value = "This edge already exists.";
      return;
    }
    if (
      !project.value.variables.some((v) => v.id === source) ||
      !project.value.variables.some((v) => v.id === target)
    )
      return;
    project.value.edges.push({
      id: crypto.randomUUID(),
      source,
      target,
      sourceHandle,
      targetHandle,
    });
    touch();
  }
  function removeNode(id: string) {
    if (
      !confirm(
        "Delete this variable and its edges, evidence and dependent CPTs?",
      )
    )
      return;
    project.value.variables = project.value.variables.filter(
      (v) => v.id !== id,
    );
    project.value.edges = project.value.edges.filter(
      (e) => e.source !== id && e.target !== id,
    );
    project.value.cpts = project.value.cpts.filter((c) => c.variableId !== id);
    delete project.value.evidence[id];
    for (const group of project.value.queryGroups)
      group.targetIds = group.targetIds.filter((x) => x !== id);
    selected.value = "";
    touch();
  }
  async function previewTraining() {
    const p = await job("preview", payload(), (x) =>
      z
        .object({
          retained: z.number(),
          dropped: z.number(),
          counts: z.array(z.array(z.number())),
        })
        .parse(x),
    );
    if (p) trainingPreview.value = { ...p, stamp: trainingStamp() };
  }
  async function train(method: "mle" | "dirichlet", alpha: number) {
    if (
      !trainingPreview.value ||
      trainingPreview.value.stamp !== trainingStamp()
    ) {
      error.value = "Review training data for the current model first.";
      return;
    }
    const r = await job("train", payload({ method, alpha }), (x) => {
      const result = z
        .object({
          cpts: z.array(cptSchema),
          retained: z.number().int().nonnegative(),
          dropped: z.number().int().nonnegative(),
        })
        .parse(x);
      validateProject({ ...project.value, cpts: result.cpts });
      return result;
    });
    if (!r) return;
    project.value.cpts = r.cpts;
    touch("model");
    if (trainingPreview.value) trainingPreview.value.stamp = trainingStamp();
    notice.value = `Trained ${r.cpts.length} CPTs from ${r.retained} rows; ${r.dropped} excluded.`;
  }
  async function query() {
    const snapshot = JSON.parse(JSON.stringify(project.value)) as Project;
    const r = await job(
      "infer",
      {
        ...payload(),
        dataset: undefined,
        engineUrl: new URL(
          `${import.meta.env.BASE_URL}vendor/jsagrum/dist/index.js`,
          location.origin,
        ).href,
      },
      (x) => {
        const r = resultSchema.parse(x);
        for (const v of snapshot.variables)
          if (
            r.prior[v.id]?.length !== v.states.length ||
            r.posterior[v.id]?.length !== v.states.length
          )
            throw new Error("Invalid graph probability response.");
        for (const g of snapshot.queryGroups) {
          const j = r.groups[g.id];
          const shape = g.targetIds.map(
            (id) => snapshot.variables.find((v) => v.id === id)!.states.length,
          );
          const size = shape.reduce((a, b) => a * b, 1);
          if (
            !j ||
            JSON.stringify(j.targetIds) !== JSON.stringify(g.targetIds) ||
            JSON.stringify(j.shape) !== JSON.stringify(shape) ||
            j.prior.length !== size ||
            j.posterior.length !== size
          )
            throw new Error("Invalid joint probability response.");
        }
        return r;
      },
    );
    if (r) {
      results.value = r;
      resultSnapshot.value = snapshot;
      resultStamp.value = stamp();
      notice.value = "Exact discrete inference completed.";
    }
  }
  async function openProject(text: string) {
    try {
      if (new TextEncoder().encode(text).length > LIMITS.fileBytes)
        throw new Error("Project exceeds 100 MiB.");
      const p = validateProject(JSON.parse(text));
      let d: Dataset | undefined;
      if (p.dataset?.embeddedCsv) {
        const descriptor = p.dataset;
        d = await job(
          "import",
          {
            csv: descriptor.embeddedCsv,
            name: descriptor.name,
            delimiter: descriptor.delimiter,
            tokens: p.missingTokens,
          },
          (x) => datasetSchema.parse(x),
        );
        if (!d) return;
        if (d.hash !== descriptor.hash)
          throw new Error("Embedded dataset hash does not match.");
      }
      if (dirty.value && !confirm("Replace unsaved work with this project?"))
        return;
      client.cancel();
      project.value = p;
      activeTab.value = "build";
      dataset.value = d;
      results.value = undefined;
      resultSnapshot.value = undefined;
      resultStamp.value = "";
      trainingPreview.value = undefined;
      selected.value = "";
      revisions.value = { model: 0, data: 0, query: 0 };
      dirty.value = false;
      notice.value = d
        ? "Project and dataset opened."
        : "Project opened. Reattach its CSV to retrain; saved CPTs can be queried.";
      error.value = "";
    } catch (e) {
      error.value = `Could not open project: ${e instanceof Error ? e.message : e}`;
    }
  }
  function savedProject(embed: boolean) {
    const p = JSON.parse(JSON.stringify(project.value)) as Project;
    if (p.dataset) {
      delete p.dataset.embeddedCsv;
      if (embed && dataset.value) p.dataset.embeddedCsv = dataset.value.csv;
    }
    return JSON.stringify(validateProject(p), null, 2);
  }
  function newProject() {
    if (
      dirty.value &&
      !confirm("Discard unsaved changes and create a new project?")
    )
      return;
    client.cancel();
    activeTab.value = "build";
    project.value = emptyProject();
    dataset.value = undefined;
    results.value = undefined;
    resultSnapshot.value = undefined;
    resultStamp.value = "";
    selected.value = "";
    trainingPreview.value = undefined;
    touch();
  }
  async function layout() {
    const r = await job(
      "layout",
      {
        project: project.value,
        layoutUrl: new URL(
          `${import.meta.env.BASE_URL}vendor/elkjs/elk-worker.min.js`,
          location.origin,
        ).href,
      },
      (x) =>
        z
          .array(z.object({ id: z.string(), x: z.number(), y: z.number() }))
          .parse(x),
    );
    if (r) {
      for (const pos of r) {
        const v = project.value.variables.find((v) => v.id === pos.id);
        if (v) v.position = { x: pos.x, y: pos.y };
      }
      touch("display");
    }
  }
  function setEvidence(id: string, value: EvidenceValue | undefined) {
    if (value === undefined) delete project.value.evidence[id];
    else project.value.evidence[id] = value;
    touch("query");
  }
  async function addThresholdCut(id: string) {
    try {
      const v = project.value.variables.find((v) => v.id === id),
        e = project.value.evidence[id];
      if (!v?.binning || typeof e !== "object" || e.kind !== "threshold")
        return;
      if (!dataset.value) {
        error.value =
          "Reattach the source CSV in Build to add a cut and retrain.";
        return;
      }
      if (
        !confirm(
          "Add this exact cut? This changes the variable states and invalidates dependent CPTs. Retrain before inference.",
        )
      )
        return;
      const cuts = [...new Set([...v.binning.cuts, thresholdCut(e)])].sort(
        (a, b) => a - b,
      );
      await configure(
        v.columnId,
        "discretised",
        "manual",
        cuts.length + 1,
        cuts,
      );
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  }

  async function exportGraph(withProbabilities: boolean) {
    if (withProbabilities && !current.value) {
      error.value =
        "Run inference for current probabilities before exporting them.";
      return;
    }
    return await job(
      "graph",
      {
        project: project.value,
        options: {
          posterior: withProbabilities ? results.value!.posterior : undefined,
        },
      },
      (x) => z.object({ svg: z.string() }).parse(x),
    );
  }
  async function exportSamples(
    groupId: string,
    options: import("./sampling").SampleOptions,
  ) {
    if (!current.value || !results.value?.groups[groupId]) {
      error.value = "Run inference before sampling the current query.";
      return;
    }
    return await job(
      "sample",
      {
        project: project.value,
        options: { ...options, groupId, joint: results.value.groups[groupId] },
      },
      (x) =>
        z
          .object({ archive: z.instanceof(Uint8Array), count: z.number() })
          .parse(x),
    );
  }
  function cancel() {
    client.cancel();
  }
  return {
    setEvidence,
    addThresholdCut,
    exportGraph,
    exportSamples,
    activeTab,
    embedDataset,
    renameStates,
    setPrecision,
    setParameterMode,
    addGroup,
    removeGroup,
    project,
    dataset,
    busy,
    error,
    notice,
    dirty,
    selected,
    revisions,
    results,
    resultSnapshot,
    resultStamp,
    current,
    cycles,
    trainingPreview,
    stamp,
    trainingStamp,
    touch,
    importCsv,
    reattach,
    configure,
    addEdge,
    removeNode,
    previewTraining,
    train,
    query,
    openProject,
    savedProject,
    newProject,
    cancel,
    layout,
  };
});
