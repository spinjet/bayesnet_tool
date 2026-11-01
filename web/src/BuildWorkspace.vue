<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  VueFlow,
  Handle,
  Position,
  useVueFlow,
  type Connection,
} from "@vue-flow/core";
import { useProject } from "./store";
import {
  cptSize,
  LIMITS,
  stateLabel,
  precisionWarning,
  type Variable,
} from "./domain";
const st = useProject(),
  flow = useVueFlow({ id: "build" });
const stateNames = ref<string[]>([]);
const csvInput = ref<HTMLInputElement>(),
  attachInput = ref<HTMLInputElement>();
const delimiter = ref("");
const representation = ref<Variable["representation"]>("categorical"),
  binMethod = ref<"manual" | "equalWidth" | "quantile">("equalWidth"),
  bins = ref(3),
  manual = ref(""),
  tokenText = ref("");
const source = ref(""),
  destination = ref("");
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
watch(
  () => selected.value?.id,
  (id) => {
    if (id) inspect(id);
  },
  { immediate: true },
);
watch(
  () => selected.value?.stateLabels,
  (labels) => (stateNames.value = [...(labels || [])]),
  { immediate: true, deep: true },
);
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
async function read(file: File | undefined, kind: "csv" | "attach") {
  if (!file) return;
  if (file.size > LIMITS.fileBytes) {
    st.error = "File exceeds 100 MiB.";
    return;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      await file.arrayBuffer(),
    );
    if (kind === "attach") await st.reattach(text, file.name);
    else await st.importCsv(text, file.name, delimiter.value);
  } catch (e) {
    st.error = String(e);
  }
  for (const el of [csvInput.value, attachInput.value]) if (el) el.value = "";
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
async function example() {
  const imported = await st.importCsv(
    "Load,Material,Failure\nLow,Steel,No\nLow,Steel,No\nLow,Aluminium,No\nLow,Aluminium,Yes\nHigh,Steel,No\nHigh,Steel,Yes\nHigh,Aluminium,Yes\nHigh,Aluminium,Yes\n",
    "engineering-example.csv",
  );
  if (!imported || !st.dataset) return;
  for (let i = 0; i < 3; i++) await st.configure(`c${i}`, "categorical");
  const [a, b, c] = st.project.variables;
  if (a && b && c) {
    st.addEdge(a.id, c.id);
    st.addEdge(b.id, c.id);
    await st.layout();
    await st.previewTraining();
    st.notice =
      "Example ready. Open Train & Inference to train and query the model.";
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
    labels.unshift(`${v.label} = ${stateLabel(v, rem % v.states.length)}`);
    rem = Math.floor(rem / v.states.length);
  }
  return labels.join(" · ") || "Root distribution";
}
</script>
<template>
  <div>
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
          ><input type="checkbox" v-model="st.embedDataset" />Include raw CSV in
          project download</label
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
            id="build"
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
          <label v-if="selected.binning" class="field"
            >Decimal places<input
              type="number"
              min="0"
              max="12"
              step="1"
              :value="selected.displayDecimals"
              @change="
                (e) => {
                  st.setPrecision(
                    selected!.id,
                    Number((e.target as HTMLInputElement).value),
                  );
                  (e.target as HTMLInputElement).value = String(
                    selected!.displayDecimals,
                  );
                }
              "
          /></label>
          <p
            v-if="precisionWarning(selected)"
            class="precision-warning"
            role="status"
          >
            Rounded boundaries look identical. Increase decimal places; exact
            thresholds are unchanged.
          </p>
          <details v-if="selected.binning">
            <summary>Exact thresholds</summary>
            <code>{{ selected.binning.cuts.join(", ") }}</code>
          </details>
          <label class="field"
            >Parameter mode<select
              :value="selected.parameterMode"
              @change="
                st.setParameterMode(
                  selected!.id,
                  ($event.target as HTMLSelectElement).value as
                    'learned' | 'uniform',
                )
              "
            >
              <option value="learned">Learn from data</option>
              <option value="uniform">Force uniform CPT</option>
            </select></label
          >
          <p v-if="selected.parameterMode === 'uniform'" class="tiny muted">
            Training assigns equal probability to every state in every parent
            configuration. Incoming edges are retained but have no effect on
            this CPT. This does not rebalance the data or guarantee a uniform
            posterior after evidence.
          </p>
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
              <label
                v-if="selected.representation === 'categorical'"
                class="state-name-field"
                ><small>Source: {{ state }}</small
                ><input
                  :aria-label="`State display name for ${state}`"
                  v-model="stateNames[i]"
                  maxlength="200"
              /></label>
              <span v-else>{{ stateLabel(selected, i) }}</span
              ><small v-if="selectedCounts">{{ selectedCounts[i] }} rows</small>
            </li>
          </ol>
          <button
            v-if="selected.representation === 'categorical'"
            @click="st.renameStates(selected.id, stateNames)"
            class="wide"
          >
            Apply state names
          </button>
          <p v-if="selected.binning" class="tiny muted">
            Exact cuts enter the upper bin. Outer bins cover values beyond the
            fitted range. Numeric values are discretised, not modelled as
            continuous densities.
          </p>
          <details v-if="selectedCpt" class="cpt">
            <summary>Trained CPT · {{ selectedCpt.origin }}</summary>
            <p class="tiny">
              {{
                selectedCpt.origin === "uniform"
                  ? "Uniform override"
                  : selectedCpt.origin === "dirichlet"
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
                    <th v-for="(s, i) in selected.states" :key="i">
                      {{ stateLabel(selected, i) }}
                    </th>
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
                        >n = {{ n
                        }}{{
                          n === 0
                            ? selectedCpt.origin === "uniform"
                              ? " · uniform override"
                              : " · prior only"
                            : ""
                        }}</small
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
    <input
      data-testid="csv-file"
      hidden
      ref="csvInput"
      type="file"
      accept=".csv,text/csv"
      @change="read(($event.target as HTMLInputElement).files?.[0], 'csv')"
    /><input
      data-testid="attach-file"
      hidden
      ref="attachInput"
      type="file"
      accept=".csv,text/csv"
      @change="read(($event.target as HTMLInputElement).files?.[0], 'attach')"
    />
  </div>
</template>
