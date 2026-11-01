<script setup lang="ts">
import { computed, ref, watch, nextTick } from "vue";
import { VueFlow, Handle, Position, useVueFlow } from "@vue-flow/core";
import { useProject } from "./store";
import { stateLabel } from "./domain";
const st = useProject(),
  flow = useVueFlow({ id: "inference" }),
  expanded = ref<Record<string, boolean>>({});
const nodes = computed(() =>
  st.project.variables.map((v) => {
    const source = st.current
      ? v
      : st.resultSnapshot?.variables.find((old) => old.id === v.id);
    const probabilities = st.results?.posterior[v.id];
    return {
      id: v.id,
      position: v.position,
      type: "probability",
      draggable: false,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        label: v.label,
        mode: v.parameterMode,
        observed: st.project.evidence[v.id] !== undefined,
        probabilities,
        rows:
          source?.states.map((_, i) => ({
            label: stateLabel(source, i),
            probability: probabilities?.[i],
          })) || [],
      },
    };
  }),
);
const edges = computed(() =>
  st.project.edges.map((e) => ({
    ...e,
    sourceHandle: e.sourceHandle || "right",
    targetHandle: e.targetHandle || "left",
    markerEnd: "arrowclosed",
    style: { stroke: "#718599", strokeWidth: 2 },
  })),
);
let initialFit = false,
  resultFit = false;
watch(
  () => st.project.id,
  () => {
    initialFit = false;
    resultFit = false;
  },
);
watch(
  [() => st.activeTab, () => st.resultStamp, () => st.project.variables.length],
  async () => {
    if (st.activeTab !== "inference" || !st.project.variables.length) return;
    if (!initialFit || (!resultFit && st.results)) {
      initialFit = true;
      if (st.results) resultFit = true;
      await nextTick();
      requestAnimationFrame(() =>
        requestAnimationFrame(() => flow.fitView({ padding: 0.2 })),
      );
    }
  },
);
</script>
<template>
  <section class="probability-graph" aria-label="Inference network">
    <div class="subpane-heading">
      <div>
        <span class="eyebrow">NETWORK POSTERIORS</span>
        <h2>Probability graph</h2>
      </div>
      <button @click="flow.fitView({ padding: 0.2 })">Fit view</button>
    </div>
    <p v-if="st.results && !st.current" class="outdated-label">
      Outdated probabilities — run inference again
    </p>
    <div class="graph-wrap">
      <VueFlow
        id="inference"
        :nodes="nodes"
        :edges="edges"
        :nodes-draggable="false"
        :nodes-connectable="false"
        :edges-updatable="false"
        :delete-key-code="null"
        :min-zoom="0.15"
        :max-zoom="2"
        @node-click="(e) => (st.selected = e.node.id)"
      >
        <template #node-probability="{ id, data }"
          ><Handle
            v-for="side in [
              Position.Left,
              Position.Right,
              Position.Top,
              Position.Bottom,
            ]"
            :key="side"
            :id="side"
            type="source"
            :position="side"
            :connectable="false"
          />
          <div
            class="network-node probability-node nowheel"
            :class="{
              observed: data.observed,
              stale: st.results && !st.current,
            }"
          >
            <div class="node-type">
              <span>{{
                data.mode === "uniform" ? "Uniform CPT" : "Learned CPT"
              }}</span
              ><span v-if="data.observed">● Evidence</span>
            </div>
            <strong>{{ data.label }}</strong>
            <p v-if="!data.probabilities" class="tiny muted">Not computed</p>
            <template v-else
              ><div
                v-for="(row, k) in data.rows.slice(0, expanded[id] ? 64 : 3)"
                :key="k"
                class="node-probability"
              >
                <span :title="row.label">{{ row.label }}</span
                ><b :title="String(row.probability)"
                  >{{ ((row.probability ?? 0) * 100).toFixed(1) }}%</b
                >
                <div
                  class="prob-bar posterior"
                  :style="{ width: `${(row.probability ?? 0) * 100}%` }"
                ></div>
              </div>
              <button
                v-if="data.rows.length > 3"
                class="nodrag nopan"
                @click.stop="expanded[id] = !expanded[id]"
              >
                {{
                  expanded[id] ? "Show fewer" : `All ${data.rows.length} states`
                }}
              </button></template
            >
          </div>
        </template>
      </VueFlow>
      <p v-if="!st.project.variables.length" class="empty-canvas">
        Add variables in Build to see the network here.
      </p>
    </div>
    <p class="tiny muted graph-note">
      Read-only network · edit structure and positions in Build.
    </p>
  </section>
</template>
