<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { stateLabel, type Project } from "./domain";
import type { JointResult } from "./engine";
const props = defineProps<{
  project: Project;
  result: JointResult;
  current: boolean;
}>();
const filters = ref<Record<string, string>>({}),
  page = ref(0),
  sort = ref("probability");
watch(
  () => props.result,
  () => {
    filters.value = {};
    page.value = 0;
  },
  { immediate: true },
);
watch([filters, sort], () => (page.value = 0), { deep: true });
const variables = computed(() =>
  props.result.targetIds.map((id) =>
    props.project.variables.find((v) => v.id === id)!,
  ),
);
const rows = computed(() =>
  props.result.posterior.map((probability, index) => {
    let rem = index;
    const states = Array(variables.value.length).fill(0);
    for (let i = states.length - 1; i >= 0; i--) {
      states[i] = rem % props.result.shape[i];
      rem = Math.floor(rem / props.result.shape[i]);
    }
    return { index, states, probability, prior: props.result.prior[index] };
  }),
);
const filtered = computed(() =>
  rows.value.filter((row) =>
    variables.value.every(
      (v, i) =>
        !filters.value[v.id] || Number(filters.value[v.id]) === row.states[i],
    ),
  ),
);
const ordered = computed(() =>
  [...filtered.value].sort(
    sort.value === "probability"
      ? (a, b) => b.probability - a.probability || a.index - b.index
      : (a, b) => a.index - b.index,
  ),
);
const visible = computed(() =>
  ordered.value.slice(page.value * 50, (page.value + 1) * 50),
);
const mass = computed(() =>
  filtered.value.reduce((sum, r) => sum + r.probability, 0),
);
const max = computed(() => Math.max(...props.result.posterior));
const percent = (n: number) => (n * 100).toFixed(3) + "%";
function cell(a: number, b: number) {
  return props.result.posterior[a * props.result.shape[1] + b];
}
function heatText(p: number) {
  const alpha = max.value ? 0.07 + (0.8 * p) / max.value : 0.07;
  const rgb = [20, 106, 105].map((c) => {
    const x = (255 * (1 - alpha) + c * alpha) / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] > 0.179
    ? "#000"
    : "#fff";
}
function color(p: number) {
  return `rgba(20,106,105,${max.value ? 0.07 + (0.8 * p) / max.value : 0.07})`;
}
</script>
<template>
  <div class="query-result" :class="{ 'stale-results': !current }">
    <p v-if="!current" class="outdated-label">
      Outdated results — run inference again
    </p>
    <p class="query-description">
      {{ variables.map((v) => v.label).join(" × ") }} ·
      {{ result.posterior.length.toLocaleString() }} combinations
    </p>
    <p
      v-if="variables.some((v) => project.evidence[v.id] !== undefined)"
      class="tiny muted"
    >
      Targets present in the shared evidence are fixed to their observed states.
    </p>
    <template v-if="variables.length === 1">
      <div class="chart-legend">
        <span class="prior-key"></span>Prior
        <span class="posterior-key"></span>Posterior
      </div>
      <table class="marginal-table">
        <thead>
          <tr>
            <th>State</th>
            <th>Prior</th>
            <th>Posterior</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.index">
            <th>{{ stateLabel(variables[0], row.states[0]) }}</th>
            <td>
              <div
                class="prob-bar prior"
                :style="{ width: `${row.prior * 100}%` }"
              ></div>
              {{ percent(row.prior) }}
            </td>
            <td>
              <div
                class="prob-bar posterior"
                :style="{ width: `${row.probability * 100}%` }"
              ></div>
              {{ percent(row.probability) }}
            </td>
          </tr>
        </tbody>
      </table>
    </template>
    <template v-else-if="variables.length === 2">
      <p class="tiny muted">
        Joint posterior · rows: {{ variables[0].label }} · columns:
        {{ variables[1].label }}
      </p>
      <div class="heatmap-scroll">
        <table class="joint-heatmap">
          <caption>
            Joint probabilities:
            {{
              variables[0].label
            }}
            ×
            {{
              variables[1].label
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">
                {{ variables[0].label }} / {{ variables[1].label }}
              </th>
              <th v-for="(_, j) in variables[1].states" :key="j" scope="col">
                {{ stateLabel(variables[1], j) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(_, i) in variables[0].states" :key="i">
              <th scope="row">{{ stateLabel(variables[0], i) }}</th>
              <td
                v-for="(_, j) in variables[1].states"
                :key="j"
                :style="{
                  background: color(cell(i, j)),
                  color: heatText(cell(i, j)),
                }"
                :title="String(cell(i, j))"
              >
                {{ percent(cell(i, j)) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="tiny muted">
        Colour scale: 0–{{ percent(max) }}. Values are probabilities of
        combinations, not separate marginals.
      </p>
    </template>
    <template v-if="variables.length > 1">
      <fieldset v-if="variables.length >= 3" class="combination-filters">
        <legend>Filter combinations</legend>
        <label v-for="v in variables" :key="v.id" class="field"
          >{{ v.label
          }}<select v-model="filters[v.id]">
            <option value="">All states</option>
            <option v-for="(_, k) in v.states" :key="k" :value="String(k)">
              {{ stateLabel(v, k) }}
            </option>
          </select></label
        >
      </fieldset>
      <div class="table-controls">
        <label
          >Sort combinations<select v-model="sort">
            <option value="probability">Posterior, highest first</option>
            <option value="state">State order</option>
          </select></label
        ><span
          >Displayed probability mass: {{ percent(mass) }} ·
          {{ filtered.length }} combinations</span
        >
      </div>
      <div class="joint-table-scroll">
        <table class="combination-table">
          <caption>
            Joint distribution table
          </caption>
          <thead>
            <tr>
              <th v-for="v in variables" :key="v.id" scope="col">
                {{ v.label }}
              </th>
              <th>Prior</th>
              <th>Posterior</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in visible" :key="row.index">
              <th v-for="(v, i) in variables" :key="v.id">
                {{ stateLabel(v, row.states[i]) }}
              </th>
              <td>{{ percent(row.prior) }}</td>
              <td :title="String(row.probability)">
                {{ percent(row.probability) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <button @click="page--" :disabled="page === 0">Previous</button
        ><span
          >Page {{ page + 1 }} of
          {{ Math.max(1, Math.ceil(filtered.length / 50)) }}</span
        ><button @click="page++" :disabled="(page + 1) * 50 >= filtered.length">
          Next
        </button>
      </div>
      <p v-if="variables.length >= 3" class="tiny muted">
        Filters do not renormalise probabilities. Exports include the full
        distribution.
      </p>
    </template>
  </div>
</template>
