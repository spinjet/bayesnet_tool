<script setup lang="ts">
import { computed, ref, watch, nextTick } from "vue";
import { useProject } from "./store";
import {
  inferenceReady,
  stateLabel,
  evidenceLabel,
  resolveEvidence,
} from "./domain";
import { validateQueries, querySize, QUERY_LIMITS } from "./engine";
import { csvCell, download } from "./files";
import ProbabilityGraph from "./ProbabilityGraph.vue";
import EvidenceControl from "./EvidenceControl.vue";
import SampleExport from "./SampleExport.vue";
import QueryResults from "./QueryResults.vue";
const st = useProject(),
  topPercent = ref(66),
  method = ref<"mle" | "dirichlet">("dirichlet"),
  alpha = ref(1),
  activeGroupId = ref("");
watch(
  () => st.project.queryGroups.map((g) => g.id),
  (ids) => {
    if (!ids.includes(activeGroupId.value)) activeGroupId.value = ids[0] || "";
  },
  { immediate: true },
);
const active = computed(() =>
  st.project.queryGroups.find((g) => g.id === activeGroupId.value),
);
const result = computed(() => st.results?.groups[activeGroupId.value]);
const resultProject = computed(() =>
  st.current ? st.project : st.resultSnapshot || st.project,
);
const queryError = computed(() => {
  try {
    inferenceReady(st.project);
    resolveEvidence(st.project);
    validateQueries(st.project.variables, st.project.queryGroups);
    return "";
  } catch (e) {
    return (e as Error).message;
  }
});
const totalSize = computed(() =>
  st.project.queryGroups.reduce(
    (n, g) => n + querySize(st.project.variables, g),
    0,
  ),
);
const evidenceDescription = computed(
  () =>
    Object.entries(resultProject.value.evidence)
      .map(([id, k]) => {
        const v = resultProject.value.variables.find((v) => v.id === id)!;
        return evidenceLabel(v, k);
      })
      .join(" · ") || "None (prior distributions)",
);
function target(id: string, checked: boolean) {
  if (!active.value) return;
  active.value.targetIds = checked
    ? [...active.value.targetIds, id]
    : active.value.targetIds.filter((x) => x !== id);
  st.touch("query");
}
function moveTarget(index: number, direction: number) {
  const group = active.value;
  if (!group) return;
  const other = index + direction;
  if (other < 0 || other >= group.targetIds.length) return;
  [group.targetIds[index], group.targetIds[other]] = [
    group.targetIds[other],
    group.targetIds[index],
  ];
  st.touch("query");
}
function renameGroup(value: string) {
  if (!active.value) return;
  if (!value.trim()) {
    st.error = "Query name cannot be blank.";
    return;
  }
  active.value.name = value.trim().slice(0, 100);
  st.touch("display");
  st.error = "";
}
async function addGroup() {
  const id = st.addGroup();
  if (id) {
    activeGroupId.value = id;
    await nextTick();
    document.getElementById(`query-tab-${id}`)?.focus();
  }
}
function queryTabKeys(e: KeyboardEvent) {
  const groups = st.project.queryGroups;
  if (!groups.length) return;
  let i = groups.findIndex((g) => g.id === activeGroupId.value);
  if (e.key === "ArrowRight") i = (i + 1) % groups.length;
  else if (e.key === "ArrowLeft") i = (i + groups.length - 1) % groups.length;
  else if (e.key === "Home") i = 0;
  else if (e.key === "End") i = groups.length - 1;
  else return;
  e.preventDefault();
  activeGroupId.value = groups[i].id;
  document.getElementById(`query-tab-${groups[i].id}`)?.focus();
}
function exportGroup(kind: "json" | "csv") {
  if (!st.current || !result.value || !active.value) return;
  const project = st.project,
    joint = result.value;
  const variables = joint.targetIds.map((id) =>
    project.variables.find((v) => v.id === id)!,
  );
  const provenance = {
    projectId: project.id,
    revisions: { ...st.revisions },
    group: { ...active.value },
    evidence: Object.entries(project.evidence).map(([id, k]) => {
      const v = project.variables.find((v) => v.id === id)!;
      return { variableId: id, assignment: k, label: evidenceLabel(v, k) };
    }),
    engine: "jsagrum@0.1.3",
    method: "exact joint via conditional inference",
    datasetHash: project.dataset?.hash,
    training: project.cpts.map((c) => ({
      variableId: c.variableId,
      origin: c.origin,
      alphaPerCell: c.alphaPerCell,
      trainedAt: c.trainedAt,
    })),
    variables: variables.map((v) => ({
      id: v.id,
      label: v.label,
      states: v.states.map((sourceValue, index) => ({
        stateId: index,
        sourceValue,
        label: stateLabel(v, index),
      })),
      binning: v.binning,
    })),
  };
  if (kind === "json")
    download(
      "pdopt-bn-query.json",
      JSON.stringify({ provenance, ...joint }, null, 2),
    );
  else {
    const rows: unknown[][] = [
      [
        ...variables.flatMap((v) => [
          `${v.id}:stateId`,
          `${v.label}:stateLabel`,
        ]),
        "prior",
        "posterior",
        "provenance",
      ],
    ];
    joint.posterior.forEach((p, index) => {
      let rem = index;
      const states = Array(variables.length).fill(0);
      for (let i = variables.length - 1; i >= 0; i--) {
        states[i] = rem % joint.shape[i];
        rem = Math.floor(rem / joint.shape[i]);
      }
      rows.push([
        ...variables.flatMap((v, i) => [states[i], stateLabel(v, states[i])]),
        joint.prior[index],
        p,
        JSON.stringify(provenance),
      ]);
    });
    download(
      "pdopt-bn-query.csv",
      rows.map((r) => r.map(csvCell).join(",")).join("\r\n"),
      "text/csv",
    );
  }
}
</script>
<template>
  <main class="inference-workspace">
    <div
      class="inference-upper"
      :style="{ flexGrow: topPercent, flexBasis: 0 }"
    >
      <ProbabilityGraph />
      <section class="output-pane" aria-label="Query results">
        <div class="subpane-heading">
          <div>
            <span class="eyebrow">COMBINED INFERENCE</span>
            <h2>Query views</h2>
          </div>
          <button
            @click="addGroup"
            :disabled="
              st.project.queryGroups.length >= 10 ||
              !st.project.variables.length
            "
          >
            ＋ Add query
          </button>
        </div>
        <div
          class="query-tabs"
          role="tablist"
          aria-label="Query views"
          @keydown="queryTabKeys"
        >
          <button
            v-for="g in st.project.queryGroups"
            :key="g.id"
            :id="`query-tab-${g.id}`"
            role="tab"
            :aria-selected="activeGroupId === g.id"
            :tabindex="activeGroupId === g.id ? 0 : -1"
            :aria-controls="`query-result-${g.id}`"
            @click="activeGroupId = g.id"
          >
            {{ g.name }}
          </button>
        </div>
        <div
          v-if="active"
          :id="`query-result-${active.id}`"
          role="tabpanel"
          :aria-labelledby="`query-tab-${active.id}`"
          class="query-output"
        >
          <div class="result-actions">
            <strong>{{
              result
                ? st.current
                  ? "Current results"
                  : "Outdated results"
                : "Not computed"
            }}</strong
            ><button
              @click="exportGroup('json')"
              :disabled="!st.current || !result"
            >
              Export JSON</button
            ><button
              @click="exportGroup('csv')"
              :disabled="!st.current || !result"
            >
              Export CSV
            </button>
          </div>
          <p v-if="result" class="tiny muted">
            Evidence: {{ evidenceDescription }}
          </p>
          <SampleExport v-if="active" :group-id="active.id" />
          <QueryResults
            v-if="result"
            :project="resultProject"
            :result="result"
            :current="st.current"
          />
          <p v-else class="empty-results">
            Choose targets below, then run inference. Graph nodes show
            individual marginals; multi-target views show joint probabilities.
          </p>
        </div>
        <p v-else class="empty-results">
          Add a query view to explore a single target or a combination of
          targets.
        </p>
      </section>
    </div>
    <div class="analysis-actionbar">
      <div class="resize-controls">
        <label
          >Results area height
          <input
            aria-label="Results area height"
            type="range"
            min="45"
            max="80"
            v-model.number="topPercent" /></label
        ><span
          >{{ topPercent }}% results / {{ 100 - topPercent }}% controls</span
        >
      </div>
      <span class="tiny muted">{{
        queryError || "Update network probabilities and all query views"
      }}</span
      ><button
        class="primary"
        @click="st.query()"
        :disabled="st.busy || !!queryError"
      >
        Run inference
      </button>
    </div>
    <section
      class="inference-controls"
      aria-label="Training and inference controls"
      :style="{ flexGrow: 100 - topPercent, flexBasis: 0 }"
    >
      <fieldset class="training-fieldset">
        <legend>Training</legend>
        <div class="training-settings">
          <p class="tiny muted">
            Complete records only. Training replaces all
            {{ st.project.cpts.length }} CPTs atomically.
          </p>
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
              v-model.number="alpha" /></label
          ><button
            @click="st.previewTraining()"
            :disabled="st.busy || !st.dataset || !st.project.variables.length"
          >
            Review training data
          </button>
          <p v-if="st.trainingPreview?.stamp === st.trainingStamp()">
            {{ st.trainingPreview.retained }} rows retained ·
            {{ st.trainingPreview.dropped }} excluded
          </p>
          <p v-if="!st.dataset" class="tiny muted">
            Reattach the source CSV in Build to train. Saved valid CPTs can
            still be queried.
          </p>
          <p v-if="st.cycles.length" class="tiny error">
            Resolve the cycle in Build before training.
          </p>
        </div>
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
          Train model
        </button>
      </fieldset>
      <fieldset>
        <legend>Shared evidence</legend>
        <div class="evidence-list">
          <EvidenceControl
            v-for="v in st.project.variables"
            :key="v.id"
            :variable="v"
          />
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
        <legend>Query configuration</legend>
        <template v-if="active"
          ><label class="field"
            >Query name<input
              :key="active.id"
              :value="active.name"
              maxlength="100"
              @change="renameGroup(($event.target as HTMLInputElement).value)"
          /></label>
          <fieldset class="target-selector">
            <legend>Targets for active query</legend>
            <label v-for="v in st.project.variables" :key="v.id" class="check"
              ><input
                type="checkbox"
                :checked="active.targetIds.includes(v.id)"
                @change="
                  target(v.id, ($event.target as HTMLInputElement).checked)
                "
              />{{ v.label }}</label
            >
          </fieldset>
          <ol class="target-order">
            <li v-for="(id, i) in active.targetIds" :key="id">
              {{ st.project.variables.find((v) => v.id === id)?.label
              }}<button
                :aria-label="`Move target ${i + 1} up`"
                @click="moveTarget(i, -1)"
                :disabled="i === 0"
              >
                ↑</button
              ><button
                :aria-label="`Move target ${i + 1} down`"
                @click="moveTarget(i, 1)"
                :disabled="i === active.targetIds.length - 1"
              >
                ↓
              </button>
            </li>
          </ol>
          <p class="tiny">
            {{ querySize(st.project.variables, active).toLocaleString() }}
            combinations in this group · {{ totalSize.toLocaleString() }} total
          </p>
          <button class="danger" @click="st.removeGroup(active.id)">
            Remove query
          </button></template
        >
        <p class="tiny muted">
          Limits: {{ QUERY_LIMITS.perGroup.toLocaleString() }} per group,
          {{ QUERY_LIMITS.total.toLocaleString() }} total,
          {{ QUERY_LIMITS.groups }} groups.
        </p>
        <p v-if="queryError" class="query-blocker">{{ queryError }}</p>
      </fieldset>
    </section>
  </main>
</template>
