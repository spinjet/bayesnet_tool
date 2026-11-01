<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from "vue";
import {
  VueFlow,
  Handle,
  Position,
  useVueFlow,
  type Connection,
} from "@vue-flow/core";
import { useProject } from "./store";
import { cptSize, LIMITS, inferenceReady, type Variable } from "./domain";
import { encode } from "./processing";
const st = useProject(),
  flow = useVueFlow();
const csvInput = ref<HTMLInputElement>(),
  openInput = ref<HTMLInputElement>(),
  attachInput = ref<HTMLInputElement>();
const delimiter = ref(""),
  embed = ref(false),
  method = ref<"mle" | "dirichlet">("dirichlet"),
  alpha = ref(1),
  trainingOpen = ref(false),
  queryOpen = ref(true);
const representation = ref<Variable["representation"]>("categorical"),
  binMethod = ref<"manual" | "equalWidth" | "quantile">("equalWidth"),
  bins = ref(3),
  manual = ref(""),
  tokenText = ref("");
const source = ref(""),
  destination = ref(""),
  numericEvidence = ref<Record<string, string | number>>({});
const selected = computed(() =>
  st.project.variables.find((v) => v.id === st.selected),
);
const cptEstimate = computed(() => {
  if (!selected.value) return "";
  try {
    return `${cptSize(st.project, selected.value.id).toLocaleString()} CPT cells`;
  } catch (e) {
    return (e as Error).message;
  }
});
const selectedCpt = computed(() =>
  st.project.cpts.find((c) => c.variableId === st.selected),
);
const selectedCounts = computed(() => {
  const i = st.project.variables.findIndex((v) => v.id === st.selected);
  return st.trainingPreview?.stamp === st.trainingStamp()
    ? st.trainingPreview.counts[i]
    : undefined;
});
const nodes = computed(() =>
  st.project.variables.map((v) => ({
    id: v.id,
    position: v.position,
    type: "default",
    data: {
      label: v.label,
      states: v.states.length,
      evidence: st.project.evidence[v.id] !== undefined,
      trained: st.project.cpts.some((c) => c.variableId === v.id),
      cycle: st.cycles.includes(v.id),
    },
    selected: st.selected === v.id,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  })),
);
const edges = computed(() =>
  st.project.edges.map((e) => ({
    ...e,
    style: {
      stroke:
        st.cycles.includes(e.source) && st.cycles.includes(e.target)
          ? "#bc3547"
          : "#718599",
      strokeWidth: 2,
    },
    markerEnd: "arrowclosed",
  })),
);
function resultVariable(id: string) {
  return (st.current ? st.project : st.resultSnapshot)?.variables.find(
    (v) => v.id === id,
  );
}
const resultEvidence = computed(() => {
  const p = st.current ? st.project : st.resultSnapshot;
  return p
    ? Object.entries(p.evidence)
        .map(
          ([id, k]) =>
            `${p.variables.find((v) => v.id === id)?.label} = ${p.variables.find((v) => v.id === id)?.states[k]}`,
        )
        .join(" · ")
    : "";
});
const blocked = computed(() => {
  try {
    inferenceReady(st.project);
    return "";
  } catch (e) {
    return (e as Error).message;
  }
});
function inspect(id: string) {
  st.selected = id;
  const v = selected.value;
  if (v) {
    representation.value = v.representation;
    binMethod.value = v.binning?.method || "equalWidth";
    bins.value = v.binning?.requestedBins || 3;
    manual.value = v.binning?.cuts.join(", ") || "";
  }
}
async function read(
  file: File | undefined,
  kind: "csv" | "project" | "attach",
) {
  if (!file) return;
  if (file.size > LIMITS.fileBytes) {
    st.error = "File exceeds 100 MiB.";
    return;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      await file.arrayBuffer(),
    );
    if (kind === "project") await st.openProject(text);
    else if (kind === "attach") await st.reattach(text, file.name);
    else await st.importCsv(text, file.name, delimiter.value);
  } catch (e) {
    st.error = String(e);
  }
  for (const el of [csvInput.value, openInput.value, attachInput.value])
    if (el) el.value = "";
}
async function addColumn(i: number) {
  const p = st.dataset!.profiles[i];
  await st.configure(`c${i}`, p.numeric ? "discretised" : "categorical");
  if (st.selected) inspect(st.selected);
}
function configure() {
  if (!selected.value) return;
  if (
    st.project.cpts.length &&
    !confirm(
      "Changing variable states or bins invalidates dependent CPTs and query results. Continue?",
    )
  )
    return;
  void st.configure(
    selected.value.columnId,
    representation.value,
    binMethod.value,
    bins.value,
    manual.value
      .split(",")
      .filter((x) => x.trim())
      .map(Number),
  );
}
function connect(c: Connection) {
  if (c.source && c.target) st.addEdge(c.source, c.target);
}
function dropEdge(id: string) {
  st.project.edges = st.project.edges.filter((e) => e.id !== id);
  st.touch();
}
function setEvidence(id: string, value: string) {
  if (value === "") delete st.project.evidence[id];
  else st.project.evidence[id] = Number(value);
  st.touch("query");
}
function setNumericEvidence(v: Variable) {
  try {
    st.project.evidence[v.id] = encode(
      v,
      String(numericEvidence.value[v.id] ?? ""),
    );
    st.touch("query");
    st.error = "";
  } catch (e) {
    st.error = (e as Error).message;
  }
}
function toggleTarget(id: string, checked: boolean) {
  st.project.targetIds = checked
    ? [...st.project.targetIds, id]
    : st.project.targetIds.filter((x) => x !== id);
  st.touch("query");
}
function download(name: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function save() {
  try {
    download(
      `${st.project.name.replace(/[^\p{L}\p{N}_-]/gu, "_")}.bayesnet.json`,
      st.savedProject(embed.value),
    );
    st.dirty = false;
    st.notice = "Project downloaded. Keep this file as your portable backup.";
  } catch (e) {
    st.error = String(e);
  }
}
function exportResults(kind: "json" | "csv") {
  if (!st.current || !st.results) return;
  const evidence = Object.entries(st.project.evidence).map(([id, state]) => {
    const v = st.project.variables.find((v) => v.id === id)!;
    return {
      variableId: id,
      label: v.label,
      stateId: state,
      stateLabel: v.states[state],
    };
  });
  const provenance = {
    projectId: st.project.id,
    revisions: st.revisions,
    evidence,
    method: "exact discrete inference",
    engine: "jsagrum@0.1.3",
    datasetHash: st.project.dataset?.hash,
    missingTokens: st.project.missingTokens,
    variables: st.project.variables.map((v) => ({
      id: v.id,
      states: v.states,
      representation: v.representation,
      binning: v.binning,
    })),
    training: st.project.cpts.map((c) => ({
      variableId: c.variableId,
      method: c.origin,
      alphaPerCell: c.alphaPerCell,
      trainedAt: c.trainedAt,
    })),
  };
  if (kind === "json")
    download(
      "posterior-results.json",
      JSON.stringify({ provenance, ...st.results }, null, 2),
    );
  else {
    const cell = (x: unknown) => {
      let s = String(x);
      if (/^(\s*[=+\-@]|[\t\r])/.test(s)) s = "'" + s;
      return '"' + s.replaceAll('"', '""') + '"';
    };
    const rows: unknown[][] = [
      [
        "variableId",
        "variable",
        "stateId",
        "state",
        "prior",
        "posterior",
        "provenance",
      ],
    ];
    for (const id of st.project.targetIds) {
      const v = st.project.variables.find((v) => v.id === id)!;
      v.states.forEach((s, i) =>
        rows.push([
          id,
          v.label,
          i,
          s,
          st.results!.prior[id][i],
          st.results!.posterior[id][i],
          JSON.stringify(provenance),
        ]),
      );
    }
    download(
      "posterior-results.csv",
      rows.map((r) => r.map(cell).join(",")).join("\r\n"),
      "text/csv",
    );
  }
}
async function example() {
  await st.importCsv(
    "Load,Material,Failure\nLow,Steel,No\nLow,Steel,No\nLow,Aluminium,No\nLow,Aluminium,Yes\nHigh,Steel,No\nHigh,Steel,Yes\nHigh,Aluminium,Yes\nHigh,Aluminium,Yes\n",
    "engineering-example.csv",
  );
  if (!st.dataset) return;
  for (let i = 0; i < 3; i++) await st.configure(`c${i}`, "categorical");
  const [a, b, c] = st.project.variables;
  if (a && b && c) {
    st.addEdge(a.id, c.id);
    st.addEdge(b.id, c.id);
    await st.layout();
    await st.previewTraining();
    trainingOpen.value = true;
  }
}
function parentAssignment(
  c: NonNullable<typeof selectedCpt.value>,
  row: number,
) {
  const labels: string[] = [];
  let rem = row;
  for (let i = c.parentIds.length - 1; i >= 0; i--) {
    const v = st.project.variables.find((v) => v.id === c.parentIds[i])!;
    labels.unshift(`${v.label} = ${v.states[rem % v.states.length]}`);
    rem = Math.floor(rem / v.states.length);
  }
  return labels.join(" · ") || "Root distribution";
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (st.dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
}
onMounted(() => window.addEventListener("beforeunload", beforeUnload));
onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload));
</script>
<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">B<span>·</span>N</span>
        <div>
          <strong>BayesNet <span class="accent">Studio</span></strong
          ><small>LOCAL-FIRST MODEL WORKSPACE</small>
        </div>
      </div>
      <div class="project-name">
        <input
          aria-label="Project name"
          v-model="st.project.name"
          @change="st.touch('display')"
          maxlength="200"
        /><span v-if="st.dirty" title="Unsaved changes">●</span>
      </div>
      <nav aria-label="Project actions">
        <button @click="st.newProject()" :disabled="st.busy">New</button
        ><button @click="openInput?.click()" :disabled="st.busy">Open</button
        ><button @click="save">Save project</button
        ><button
          class="primary"
          @click="
            trainingOpen = true;
            st.previewTraining();
          "
          :disabled="
            st.busy ||
            !st.dataset ||
            !st.project.variables.length ||
            !!st.cycles.length
          "
        >
          Train CPTs
        </button>
      </nav>
    </header>
    <div class="statusbar">
      <span class="privacy-dot"></span> Your data stays in this browser
      <span class="divider">/</span> Browser prototype
      <span class="spacer"></span
      ><span
        >{{ st.project.variables.length }} variables ·
        {{ st.project.edges.length }} connections ·
        {{ st.project.cpts.length }} trained CPTs</span
      >
    </div>
    <div v-if="st.error" class="banner error" role="alert">
      {{ st.error }}
      <button @click="st.error = ''" aria-label="Dismiss error">×</button>
    </div>
    <div v-if="st.notice" class="banner success" role="status">
      {{ st.notice }}
    </div>
    <div v-if="st.busy" class="banner working" role="status">
      Computing locally…
      <button @click="st.cancel()">Cancel computation</button>
    </div>
    <main class="workspace">
      <aside class="data-panel panel" aria-label="Dataset and variables">
        <div class="panel-heading">
          <span class="eyebrow">01 / SOURCE</span>
          <h2>Dataset & variables</h2>
        </div>
        <label class="field"
          >CSV delimiter<select v-model="delimiter">
            <option value="">Auto-detect</option>
            <option value=",">Comma</option>
            <option value=";">Semicolon</option>
            <option :value="'\t'">Tab</option>
          </select></label
        >
        <button
          class="import-button"
          @click="csvInput?.click()"
          :disabled="st.busy"
        >
          <span>＋</span> Import CSV
        </button>
        <div v-if="st.project.dataset" class="dataset-card">
          <strong>{{ st.project.dataset.name }}</strong
          ><small
            >{{ st.project.dataset.rowCount.toLocaleString() }} rows ·
            {{ st.project.dataset.headers.length }} columns</small
          ><small>{{
            st.dataset ? "Source attached" : "Source not attached"
          }}</small
          ><button
            v-if="!st.dataset"
            @click="attachInput?.click()"
            :disabled="st.busy"
          >
            Reattach matching CSV
          </button>
        </div>
        <p v-else class="muted">
          Start with a local CSV, or explore a small synthetic example.
        </p>
        <button
          v-if="!st.project.variables.length"
          @click="example"
          :disabled="st.busy"
        >
          Load engineering example
        </button>
        <details v-if="st.dataset" class="missing-settings">
          <summary>Missing-data policy</summary>
          <p>
            Incomplete rows across model variables are excluded. Empty fields
            are always missing. Other strings, including NA, are kept unless
            listed below.
          </p>
          <label class="field"
            >Additional missing tokens (comma-separated)<input
              v-model="tokenText"
              placeholder="e.g. NA, null" /></label
          ><button
            @click="
              st.project.missingTokens = [
                '',
                ...tokenText
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              ];
              st.touch('data');
            "
          >
            Apply missing tokens
          </button>
        </details>
        <div v-if="st.dataset" class="column-list">
          <div class="section-label">AVAILABLE COLUMNS</div>
          <div
            v-for="(header, i) in st.dataset.headers"
            :key="i"
            class="column-item"
          >
            <div>
              <strong>{{ header }}</strong
              ><small
                >{{
                  st.dataset.profiles[i].numeric ? "Numeric" : "Categorical"
                }}
                · {{ st.dataset.profiles[i].unique }} unique</small
              ><small
                >{{ st.dataset.profiles[i].missing }} missing at import</small
              >
            </div>
            <button
              :aria-label="`Add ${header}`"
              :disabled="
                st.busy ||
                st.project.variables.some((v) => v.columnId === `c${i}`)
              "
              @click="addColumn(i)"
            >
              {{
                st.project.variables.some((v) => v.columnId === `c${i}`)
                  ? "✓"
                  : "＋"
              }}
            </button>
          </div>
        </div>
        <details v-if="st.dataset" class="preview">
          <summary>Raw data preview (first 10 rows)</summary>
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th v-for="h in st.dataset.headers" :key="h">{{ h }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, i) in st.dataset.rows.slice(0, 10)" :key="i">
                  <td v-for="(cell, j) in row" :key="j">{{ cell }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
        <label class="check embed"
          ><input type="checkbox" v-model="embed" />Include raw CSV in project
          download</label
        >
        <p class="tiny muted">
          Off by default. Model files with trained CPTs can be queried without
          the CSV. Browser storage is not a backup.
        </p>
      </aside>
      <section class="canvas-panel" aria-label="Network editor">
        <div class="canvas-heading">
          <div>
            <span class="eyebrow">02 / MODEL</span>
            <h1>Build your network</h1>
          </div>
          <div class="canvas-tools">
            <button @click="flow.fitView({ padding: 0.25 })">Fit view</button
            ><button
              @click="st.layout()"
              :disabled="st.busy || !st.project.variables.length"
            >
              Auto layout
            </button>
          </div>
        </div>
        <div v-if="st.cycles.length" class="cycle-warning" role="alert">
          Cycle detected in {{ st.cycles.length }} variables:
          {{
            st.project.variables
              .filter((v) => st.cycles.includes(v.id))
              .map((v) => v.label)
              .join(", ")
          }}. Remove a connection before training or inference.
        </div>
        <div class="graph-wrap">
          <VueFlow
            :nodes="nodes"
            :edges="edges"
            :min-zoom="0.2"
            :max-zoom="2"
            :default-viewport="{ x: 40, y: 40, zoom: 1 }"
            :delete-key-code="null"
            @connect="connect"
            @node-click="(e) => inspect(e.node.id)"
            @node-drag-stop="
              (e) => {
                const v = st.project.variables.find((v) => v.id === e.node.id);
                if (v) {
                  v.position = { ...e.node.position };
                  st.touch('display');
                }
              }
            "
          >
            <template #node-default="{ data }"
              ><Handle type="target" :position="Position.Left" />
              <div
                class="network-node"
                :class="{ cyclic: data.cycle, observed: data.evidence }"
              >
                <div class="node-type">
                  DISCRETE VARIABLE
                  <span>{{
                    data.cycle
                      ? "⚠ Cycle"
                      : data.evidence
                        ? "● Evidence"
                        : data.trained
                          ? "✓ Trained"
                          : "○ Untrained"
                  }}</span>
                </div>
                <strong>{{ data.label }}</strong
                ><small>{{ data.states }} states</small>
              </div>
              <Handle type="source" :position="Position.Right"
            /></template>
          </VueFlow>
          <div v-if="!st.project.variables.length" class="empty-canvas">
            <div class="empty-icon">○ ── ○</div>
            <h2>A clear view of uncertainty</h2>
            <p>
              Import data and add variables to the canvas.<br />Connect them to
              describe your model’s dependencies.
            </p>
          </div>
        </div>
        <div class="graph-footer">
          <span>Drag handles to connect · Click a variable to inspect</span
          ><span>{{
            st.cycles.length
              ? "Invalid draft"
              : st.project.cpts.length === st.project.variables.length &&
                  st.project.variables.length
                ? "Model trained"
                : "Draft model"
          }}</span>
        </div>
        <details class="connection-controls">
          <summary>Connections · keyboard controls</summary>
          <div class="inline">
            <label
              >From<select v-model="source">
                <option value="">Select variable</option>
                <option
                  v-for="v in st.project.variables"
                  :value="v.id"
                  :key="v.id"
                >
                  {{ v.label }}
                </option>
              </select></label
            ><label
              >To<select v-model="destination">
                <option value="">Select variable</option>
                <option
                  v-for="v in st.project.variables"
                  :value="v.id"
                  :key="v.id"
                >
                  {{ v.label }}
                </option>
              </select></label
            ><button
              @click="st.addEdge(source, destination)"
              :disabled="!source || !destination"
            >
              Connect
            </button>
          </div>
          <ul>
            <li v-for="e in st.project.edges" :key="e.id">
              {{ st.project.variables.find((v) => v.id === e.source)?.label }} →
              {{ st.project.variables.find((v) => v.id === e.target)?.label }}
              <button
                @click="dropEdge(e.id)"
                :aria-label="`Remove connection ${st.project.variables.find((v) => v.id === e.source)?.label} to ${st.project.variables.find((v) => v.id === e.target)?.label}`"
              >
                Remove
              </button>
            </li>
          </ul>
        </details>
      </section>
      <aside class="inspector panel" aria-label="Variable settings">
        <div class="panel-heading">
          <span class="eyebrow">03 / INSPECT</span>
          <h2>Variable settings</h2>
        </div>
        <label class="field"
          >Selected variable<select
            :value="st.selected"
            :disabled="st.busy"
            @change="inspect(($event.target as HTMLSelectElement).value)"
          >
            <option value="">Select a variable</option>
            <option v-for="v in st.project.variables" :value="v.id" :key="v.id">
              {{ v.label }}
            </option>
          </select></label
        >
        <template v-if="selected"
          ><label class="field"
            >Display name<input
              v-model="selected.label"
              @change="st.touch('display')"
              maxlength="200"
          /></label>
          <div class="tiny muted">
            Source:
            {{
              st.project.dataset?.headers[Number(selected.columnId.slice(1))]
            }}
          </div>
          <label class="field"
            >Representation<select v-model="representation">
              <option value="categorical">Categorical</option>
              <option value="finiteNumeric">Finite numeric states</option>
              <option value="discretised">Discretised numeric</option>
            </select></label
          >
          <template v-if="representation === 'discretised'"
            ><label class="field"
              >Binning method<select v-model="binMethod">
                <option value="equalWidth">Equal width</option>
                <option value="quantile">Quantile</option>
                <option value="manual">Manual thresholds</option>
              </select></label
            ><label v-if="binMethod !== 'manual'" class="field"
              >Requested bins<input
                type="number"
                min="2"
                max="64"
                v-model.number="bins" /></label
            ><label v-else class="field"
              >Thresholds (comma-separated)<input
                v-model="manual"
                placeholder="10, 20, 30" /></label
          ></template>
          <button
            class="wide"
            @click="configure"
            :disabled="st.busy || !st.dataset"
          >
            Apply variable settings
          </button>
          <p class="tiny muted">{{ cptEstimate }}</p>
          <div class="section-label">
            {{ selected.states.length }} EFFECTIVE STATES
          </div>
          <p v-if="selectedCounts?.some((n) => n === 0)" class="tiny muted">
            Some states have no retained observations. Review the bins and
            training prior before interpreting results.
          </p>
          <ol class="states">
            <li v-for="(state, i) in selected.states" :key="i">
              <span>{{ state }}</span
              ><small v-if="selectedCounts">{{ selectedCounts[i] }} rows</small>
            </li>
          </ol>
          <p v-if="selected.binning" class="tiny muted">
            Exact cuts enter the upper bin. Outer bins cover values beyond the
            fitted range. Numeric values are discretised, not modelled as
            continuous densities.
          </p>
          <details v-if="selectedCpt" class="cpt">
            <summary>Trained CPT · {{ selectedCpt.origin }}</summary>
            <p class="tiny">
              {{
                selectedCpt.origin === "dirichlet"
                  ? `α per cell: ${selectedCpt.alphaPerCell}`
                  : "Maximum likelihood"
              }}
              · {{ new Date(selectedCpt.trainedAt).toLocaleString() }}
            </p>
            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Parents / count</th>
                    <th v-for="s in selected.states" :key="s">{{ s }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(n, row) in selectedCpt.rowCounts.slice(0, 100)"
                    :key="row"
                  >
                    <th>
                      {{ parentAssignment(selectedCpt, row)
                      }}<small
                        >n = {{ n }}{{ n === 0 ? " · prior only" : "" }}</small
                      >
                    </th>
                    <td v-for="(_, k) in selected.states" :key="k">
                      {{
                        selectedCpt.values[
                          row * selected.states.length + k
                        ].toFixed(5)
                      }}<small
                        >count
                        {{
                          selectedCpt.counts[row * selected.states.length + k]
                        }}</small
                      >
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-if="selectedCpt.rowCounts.length > 100" class="tiny">
              Showing first 100 parent assignments. Download the project for the
              complete CPT.
            </p>
          </details>
          <p v-else class="tiny muted">
            CPT not trained for the current variable configuration.
          </p>
          <button class="danger wide" @click="st.removeNode(selected.id)">
            Delete variable
          </button>
        </template>
        <p v-else class="muted">
          Select a node to configure its states, inspect its bins, and review
          learned probabilities.
        </p>
      </aside>
    </main>
    <section
      v-if="trainingOpen"
      class="training-panel"
      aria-label="Train model"
    >
      <div>
        <span class="eyebrow">PARAMETER LEARNING</span>
        <h2>Train CPTs from your data</h2>
        <p>
          Complete records across selected variables only. Training replaces all
          {{ st.project.cpts.length }} existing CPTs atomically.
        </p>
      </div>
      <label class="field"
        >Estimator<select v-model="method">
          <option value="dirichlet">Symmetric Dirichlet</option>
          <option value="mle">Maximum likelihood</option>
        </select></label
      ><label v-if="method === 'dirichlet'" class="field"
        >α per cell<input
          type="number"
          min="0.000001"
          step="0.1"
          v-model.number="alpha"
      /></label>
      <div>
        <button
          @click="st.previewTraining()"
          :disabled="st.busy || !st.dataset"
        >
          Review training data
        </button>
        <p v-if="st.trainingPreview?.stamp === st.trainingStamp()">
          {{ st.trainingPreview.retained }} rows retained ·
          {{ st.trainingPreview.dropped }} excluded
        </p>
        <button
          class="primary"
          @click="st.train(method, alpha)"
          :disabled="
            st.busy ||
            !st.dataset ||
            st.trainingPreview?.stamp !== st.trainingStamp() ||
            !!st.cycles.length
          "
        >
          Train model</button
        ><button @click="trainingOpen = false">Close</button>
      </div>
    </section>
    <section class="results-panel" aria-label="Inference and results">
      <div class="results-heading">
        <div>
          <span class="eyebrow">04 / EXPLORE</span>
          <h2>Evidence & posterior distributions</h2>
        </div>
        <button @click="queryOpen = !queryOpen">
          {{ queryOpen ? "Hide controls" : "Show controls" }}</button
        ><button
          class="primary"
          @click="st.query()"
          :disabled="st.busy || !!blocked || !st.project.targetIds.length"
        >
          Run inference
        </button>
      </div>
      <p v-if="blocked" class="muted">{{ blocked }}</p>
      <div
        v-if="queryOpen && st.project.variables.length"
        class="query-controls"
      >
        <fieldset>
          <legend>Shared evidence</legend>
          <div class="evidence-list">
            <div v-for="v in st.project.variables" :key="v.id">
              <label class="field"
                >{{ v.label
                }}<select
                  :value="st.project.evidence[v.id] ?? ''"
                  @change="
                    setEvidence(
                      v.id,
                      ($event.target as HTMLSelectElement).value,
                    )
                  "
                >
                  <option value="">Unobserved</option>
                  <option v-for="(s, i) in v.states" :key="i" :value="i">
                    {{ s }}
                  </option>
                </select></label
              >
              <div v-if="v.binning" class="numeric-input">
                <input
                  :aria-label="`Numeric evidence for ${v.label}`"
                  v-model="numericEvidence[v.id]"
                  placeholder="Numeric observation"
                  type="number"
                /><button @click="setNumericEvidence(v)">Map value</button>
              </div>
            </div>
          </div>
          <button
            @click="
              st.project.evidence = {};
              st.touch('query');
            "
          >
            Clear evidence
          </button>
        </fieldset>
        <fieldset>
          <legend>Target marginals</legend>
          <label v-for="v in st.project.variables" :key="v.id" class="check"
            ><input
              type="checkbox"
              :checked="st.project.targetIds.includes(v.id)"
              @change="
                toggleTarget(v.id, ($event.target as HTMLInputElement).checked)
              "
            />{{ v.label }}</label
          >
          <p class="tiny muted">
            Each target is conditioned on the same evidence. These are separate
            marginals, not a joint distribution.
          </p>
        </fieldset>
      </div>
      <div v-if="st.results" :class="{ 'stale-results': !st.current }">
        <div class="result-meta">
          <strong>{{
            st.current
              ? "Current results"
              : "Outdated results — run inference again"
          }}</strong
          ><span
            >Exact inference · Model revision
            {{ JSON.parse(st.resultStamp).model }}</span
          ><button @click="exportResults('json')" :disabled="!st.current">
            Export JSON</button
          ><button @click="exportResults('csv')" :disabled="!st.current">
            Export CSV
          </button>
        </div>
        <p class="tiny muted">
          Evidence: {{ resultEvidence || "None (prior distributions)" }}
        </p>
        <div class="result-grid">
          <article
            v-for="(probabilities, id) in st.results.posterior"
            :key="id"
            class="result-card"
          >
            <h3>{{ resultVariable(id)?.label || "Removed variable" }}</h3>
            <p
              v-if="
                (st.current ? st.project : st.resultSnapshot)?.evidence[id] !==
                undefined
              "
              class="tiny muted"
            >
              Observed target · fixed by evidence
            </p>
            <div class="chart-legend">
              <span class="prior-key"></span>Prior
              <span class="posterior-key"></span>Posterior
            </div>
            <table>
              <thead>
                <tr>
                  <th>State</th>
                  <th>Prior</th>
                  <th>Posterior</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(p, k) in probabilities" :key="k">
                  <th>{{ resultVariable(id)?.states[k] ?? k }}</th>
                  <td>
                    <div
                      class="prob-bar prior"
                      :style="{ width: `${st.results.prior[id][k] * 100}%` }"
                    ></div>
                    {{ (st.results.prior[id][k] * 100).toFixed(2) }}%
                  </td>
                  <td>
                    <div
                      class="prob-bar posterior"
                      :style="{ width: `${p * 100}%` }"
                    ></div>
                    {{ (p * 100).toFixed(2) }}%
                  </td>
                </tr>
              </tbody>
            </table>
          </article>
        </div>
      </div>
      <p v-else class="empty-results">
        Train your network, select evidence, and run inference to explore how
        probabilities change.
      </p>
    </section>
    <footer>
      BayesNet Studio · Prototype
      <span>No accounts. No data uploads. No telemetry.</span>
    </footer>
    <input
      hidden
      ref="csvInput"
      type="file"
      accept=".csv,text/csv"
      @change="read(($event.target as HTMLInputElement).files?.[0], 'csv')"
    /><input
      hidden
      ref="openInput"
      type="file"
      accept=".json,application/json"
      @change="read(($event.target as HTMLInputElement).files?.[0], 'project')"
    /><input
      hidden
      ref="attachInput"
      type="file"
      accept=".csv,text/csv"
      @change="read(($event.target as HTMLInputElement).files?.[0], 'attach')"
    />
  </div>
</template>
