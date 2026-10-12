<script setup lang="ts">
import ChatArchive from '@proj-airi/stage-ui/components/scenarios/chat-archive.vue'
import DeveloperGate from '@proj-airi/stage-ui/components/scenarios/developer-gate.vue'
import MemoryManager from '@proj-airi/stage-ui/components/scenarios/memory-manager.vue'

import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <div :class="['flex flex-col gap-6']">
    <ChatArchive />
    <details :class="['rounded-xl border border-neutral-200 p-4 dark:border-neutral-800']">
      <summary :class="['cursor-pointer text-sm font-medium']">
        {{ t('settings.chat-archive.maintenance') }}
      </summary>
      <div :class="['pt-4']">
        <DeveloperGate><MemoryManager mode="memory" /></DeveloperGate>
      </div>
    </details>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.memory-long-term.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
