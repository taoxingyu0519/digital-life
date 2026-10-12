<script setup lang="ts">
import DeveloperGate from '@proj-airi/stage-ui/components/scenarios/developer-gate.vue'
import MemoryManager from '@proj-airi/stage-ui/components/scenarios/memory-manager.vue'
</script>

<template>
  <DeveloperGate>
    <MemoryManager mode="memory" />
  </DeveloperGate>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.memory.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.memory.description
  icon: i-solar:leaf-bold-duotone
  settingsEntry: true
  order: 5
  stageTransition:
    name: slide
</route>
