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
} from "./domain";
const resultSchema = z.object({
  prior: z.record(z.string(), z.array(z.number())),
  posterior: z.record(z.string(), z.array(z.number())),
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
    touch("data");
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
      delete project.value.evidence[v.id];
    } else {
      project.value.variables.push(v);
      project.value.targetIds.push(v.id);
    }
    if (selected.value === selectedAtStart) selected.value = v.id;
    touch();
  }
  function addEdge(source: string, target: string) {
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
    project.value.edges.push({ id: crypto.randomUUID(), source, target });
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
    project.value.targetIds = project.value.targetIds.filter((x) => x !== id);
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
      (x) => resultSchema.parse(x),
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
      dataset.value = d;
      results.value = undefined;
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
    project.value = emptyProject();
    dataset.value = undefined;
    results.value = undefined;
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
  function cancel() {
    client.cancel();
  }
  return {
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
