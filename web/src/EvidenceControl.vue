<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useProject } from "./store";
import {
  allowedStates,
  stateLabel,
  type Variable,
  type EvidenceValue,
} from "./domain";
import { encode } from "./processing";
const props = defineProps<{ variable: Variable }>(),
  st = useProject();
const operator = ref<"gte" | "gt" | "lt" | "lte">("gte"),
  value = ref<number>(0),
  numeric = ref("");
const evidence = computed(() => st.project.evidence[props.variable.id]);
const preview = computed(() => {
  try {
    return evidence.value === undefined
      ? ""
      : allowedStates(props.variable, evidence.value)
          .map((k) => stateLabel(props.variable, k))
          .join(" OR ");
  } catch (e) {
    return (e as Error).message;
  }
});
watch(
  evidence,
  (e) => {
    if (typeof e === "object" && e.kind === "threshold") {
      operator.value = e.operator;
      value.value = e.value;
    }
  },
  { immediate: true },
);
function set(e: EvidenceValue | undefined) {
  st.setEvidence(props.variable.id, e);
}
function map() {
  try {
    set(encode(props.variable, String(numeric.value)));
  } catch (e) {
    st.error = String(e);
  }
}
function subset(e: Event) {
  const states = Array.from(
    (e.target as HTMLSelectElement).selectedOptions,
  ).map((o) => Number(o.value));
  if (states.length) set({ kind: "states", states });
  else set(undefined);
}
</script>
<template>
  <div class="evidence-control">
    <label class="field"
      >{{ variable.label
      }}<select
        :value="typeof evidence === 'number' ? evidence : ''"
        @change="
          set(
            ($event.target as HTMLSelectElement).value === ''
              ? undefined
              : Number(($event.target as HTMLSelectElement).value),
          )
        "
      >
        <option value="">Unobserved / custom event</option>
        <option v-for="(_, k) in variable.states" :key="k" :value="k">
          {{ stateLabel(variable, k) }}
        </option>
      </select></label
    >
    <button v-if="evidence !== undefined" @click="set(undefined)">
      Clear {{ variable.label }} evidence
    </button>
    <details>
      <summary>Multiple states / numeric threshold</summary>
      <p class="tiny muted">
        Select allowed states using Ctrl/Cmd or Shift; alternatives within a
        variable are OR, evidence across variables is AND.
      </p>
      <label class="field"
        >Allowed states for {{ variable.label
        }}<select multiple @change="subset">
          <option
            v-for="(_, k) in variable.states"
            :key="k"
            :value="k"
            :selected="
              typeof evidence === 'object' &&
              evidence.kind === 'states' &&
              evidence.states.includes(k)
            "
          >
            {{ stateLabel(variable, k) }}
          </option>
        </select></label
      >
      <template v-if="variable.representation !== 'categorical'"
        ><label class="field"
          >Comparison for {{ variable.label
          }}<select v-model="operator">
            <option value="gte">≥ (at least)</option>
            <option value="gt">&gt; (above)</option>
            <option value="lt">&lt; (below)</option>
            <option value="lte">≤ (at most)</option>
          </select></label
        ><label class="field"
          >Threshold for {{ variable.label
          }}<input type="number" step="any" v-model.number="value" /></label
        ><button
          :disabled="!Number.isFinite(value)"
          @click="set({ kind: 'threshold', operator, value })"
        >
          Apply threshold</button
        ><button
          v-if="
            variable.binning &&
            typeof evidence === 'object' &&
            evidence.kind === 'threshold'
          "
          @click="st.addThresholdCut(variable.id)"
          :disabled="st.busy"
        >
          Add exact cut &amp; retrain
        </button>
        <p class="tiny muted">
          A threshold must align with an exact bin boundary. Adding a cut
          requires retraining. Strict comparisons use the next representable
          number.
        </p></template
      >
    </details>
    <div v-if="variable.binning" class="numeric-input">
      <input
        type="number"
        v-model="numeric"
        :aria-label="`Numeric evidence for ${variable.label}`"
        placeholder="Numeric observation"
      /><button @click="map">Map value</button>
    </div>
    <p v-if="preview" class="tiny">{{ preview }}</p>
  </div>
</template>
