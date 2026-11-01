<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useProject } from "./store";
import { downloadBytes } from "./files";
const props = defineProps<{ groupId: string }>(),
  st = useProject(),
  count = ref(1000),
  seed = ref(42),
  bounds = ref<Record<string, { min: number; max: number }>>({});
const variables = computed(
  () =>
    st.project.queryGroups
      .find((g) => g.id === props.groupId)
      ?.targetIds.map((id) => st.project.variables.find((v) => v.id === id)!)
      .filter((v) => v.binning) || [],
);
watch(
  variables,
  (vs) => {
    for (const v of vs)
      if (!bounds.value[v.id])
        bounds.value[v.id] = {
          min: v.binning!.fittedRange[0],
          max: v.binning!.fittedRange[1],
        };
  },
  { immediate: true },
);
async function run() {
  const r = await st.exportSamples(props.groupId, {
    count: count.value,
    seed: seed.value,
    bounds: bounds.value,
  });
  if (r) downloadBytes("pdopt-bn-samples.zip", r.archive, "application/zip");
}
</script>
<template>
  <details>
    <summary>Sample queried distribution</summary>
    <p class="tiny">
      Samples use the complete joint posterior, regardless of table filters.
      Numeric values are uniform within finite bin bounds; this assumption is
      not a learned continuous density.
    </p>
    <label class="field"
      >Sample count<input
        type="number"
        min="1"
        max="100000"
        v-model.number="count" /></label
    ><label class="field"
      >Random seed<input
        type="number"
        min="0"
        max="4294967295"
        v-model.number="seed"
    /></label>
    <fieldset v-for="v in variables" :key="v.id">
      <legend>{{ v.label }} finite sampling bounds</legend>
      <label
        >Minimum<input
          type="number"
          step="any"
          v-model.number="bounds[v.id].min" /></label
      ><label
        >Maximum<input
          type="number"
          step="any"
          v-model.number="bounds[v.id].max"
      /></label>
    </fieldset>
    <button @click="run" :disabled="st.busy || !st.current">
      Download samples ZIP
    </button>
    <p class="tiny">
      CSV plus reproducibility manifest. Maximum 100,000 rows. Bounds must
      retain every positive-probability state.
    </p>
  </details>
</template>
