<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import { useProject } from "./store";
import { LIMITS } from "./domain";
import { download } from "./files";
import BuildWorkspace from "./BuildWorkspace.vue";
import InferenceWorkspace from "./InferenceWorkspace.vue";
const st = useProject(),
  openInput = ref<HTMLInputElement>();
async function open(file: File | undefined) {
  if (!file) return;
  if (file.size > LIMITS.fileBytes) {
    st.error = "File exceeds 100 MiB.";
    return;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      await file.arrayBuffer(),
    );
    await st.openProject(text);
  } catch (e) {
    st.error = String(e);
  }
  if (openInput.value) openInput.value.value = "";
}
function save() {
  try {
    download(
      `${st.project.name.replace(/[^\p{L}\p{N}_-]/gu, "_")}.bayesnet.json`,
      st.savedProject(st.embedDataset),
    );
    st.dirty = false;
    st.notice = "Project downloaded. Keep this file as your portable backup.";
  } catch (e) {
    st.error = String(e);
  }
}
function tabKeys(e: KeyboardEvent) {
  if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
    e.preventDefault();
    st.activeTab =
      e.key === "Home"
        ? "build"
        : e.key === "End"
          ? "inference"
          : st.activeTab === "build"
            ? "inference"
            : "build";
    document.getElementById(`${st.activeTab}-tab`)?.focus();
  }
}
function beforeUnload(e: BeforeUnloadEvent) {
  if (st.dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
}
onMounted(() => window.addEventListener("beforeunload", beforeUnload));
onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload));
</script>
<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">BN</span>
        <div>
          <strong>PDOPT-BN</strong><small>LOCAL-FIRST MODEL WORKSPACE</small>
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
        ><button @click="save">Save project</button>
      </nav>
    </header>
    <div class="statusbar">
      <span class="privacy-dot"></span>Your data stays in this browser<span
        class="spacer"
      ></span
      >{{ st.project.variables.length }} variables ·
      {{ st.project.edges.length }} connections ·
      {{ st.project.cpts.length }} trained CPTs
    </div>
    <div
      class="workspace-tabs"
      role="tablist"
      aria-label="Workspace"
      @keydown="tabKeys"
    >
      <button
        id="build-tab"
        role="tab"
        aria-controls="build-panel"
        :aria-selected="st.activeTab === 'build'"
        :tabindex="st.activeTab === 'build' ? 0 : -1"
        @click="st.activeTab = 'build'"
      >
        Build</button
      ><button
        id="inference-tab"
        role="tab"
        aria-controls="inference-panel"
        :aria-selected="st.activeTab === 'inference'"
        :tabindex="st.activeTab === 'inference' ? 0 : -1"
        @click="st.activeTab = 'inference'"
      >
        Train & Inference
      </button>
    </div>
    <div v-if="st.error" class="banner error" role="alert">
      {{ st.error
      }}<button @click="st.error = ''" aria-label="Dismiss error">×</button>
    </div>
    <div v-if="st.notice" class="banner success" role="status">
      {{ st.notice }}
    </div>
    <div v-if="st.busy" class="banner working" role="status">
      Computing locally…<button @click="st.cancel()">Cancel computation</button>
    </div>
    <section
      id="build-panel"
      role="tabpanel"
      aria-labelledby="build-tab"
      v-show="st.activeTab === 'build'"
    >
      <BuildWorkspace />
    </section>
    <section
      id="inference-panel"
      role="tabpanel"
      aria-labelledby="inference-tab"
      v-show="st.activeTab === 'inference'"
    >
      <InferenceWorkspace />
    </section>
    <footer>
      PDOPT-BN · Browser prototype<span
        >No accounts. No data uploads. No telemetry.</span
      >
    </footer>
    <input
      data-testid="project-file"
      hidden
      ref="openInput"
      type="file"
      accept=".json,application/json"
      @change="open(($event.target as HTMLInputElement).files?.[0])"
    />
  </div>
</template>
