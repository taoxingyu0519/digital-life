<script setup lang="ts">
import DeveloperGate from '@proj-airi/stage-ui/components/scenarios/developer-gate.vue'
import MemoryManager from '@proj-airi/stage-ui/components/scenarios/memory-manager.vue'
</script>

<template>
  <DeveloperGate>
    <MemoryManager mode="short-term" />
  </DeveloperGate>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.memory-short-term.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
