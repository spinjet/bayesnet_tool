<script setup lang="ts">
import { ref, watch } from "vue";
import { useProject } from "./store";
import { download, downloadBytes, svgToPng } from "./files";
const st = useProject(),
  format = ref("svg"),
  probabilities = ref(false);
watch(
  () => st.current,
  (current) => {
    if (!current) probabilities.value = false;
  },
);
async function run() {
  const snapshot = JSON.stringify(st.project);
  const r = await st.exportGraph(probabilities.value);
  if (!r) return;
  try {
    if (snapshot !== JSON.stringify(st.project))
      throw new Error("Model changed during image export. Try again.");
    if (format.value === "svg")
      download("pdopt-bn-network.svg", r.svg, "image/svg+xml");
    else {
      const png = await svgToPng(r.svg);
      if (snapshot !== JSON.stringify(st.project))
        throw new Error("Model changed during image export. Try again.");
      downloadBytes("pdopt-bn-network.png", png, "image/png");
    }
  } catch (e) {
    st.error = String(e);
  }
}
</script>
<template>
  <details class="image-export">
    <summary>Export network image</summary>
    <div class="image-export-panel">
      <label class="field"
        >Image format<select aria-label="Image format" v-model="format">
          <option value="svg">SVG</option>
          <option value="png">PNG</option>
        </select></label
      ><label class="check"
        ><input
          type="checkbox"
          v-model="probabilities"
          :disabled="!st.current"
        />Include current probabilities</label
      ><button
        @click="run"
        :disabled="
          st.busy ||
          !st.project.variables.length ||
          (probabilities && !st.current)
        "
      >
        Download network image</button
      ><small>Graphviz hierarchical layout</small>
    </div>
  </details>
</template>
