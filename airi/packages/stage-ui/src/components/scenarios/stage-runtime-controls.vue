<script setup lang="ts">
import { Button } from '@proj-airi/ui'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useStageRuntimeStore } from '../../stores/stage-runtime'

const runtime = useStageRuntimeStore()
const { t } = useI18n()
const actionFailed = ref(false)
async function perform(action: 'start' | 'close') {
  actionFailed.value = false
  try {
    await runtime[action]()
  }
  catch {
    // Another open window may still run the previous bundle and lack this action. Keep settings reachable.
    actionFailed.value = true
  }
}
</script>

<template>
  <section :class="['pointer-events-auto mx-3 mb-2 max-w-xl rounded-2xl p-3', 'bg-white/90 shadow-sm backdrop-blur-md dark:bg-neutral-900/90']" :aria-label="t('stage.runtime.title')">
    <div :class="['flex flex-wrap items-center gap-2']">
      <Button :class="['min-h-11']" size="sm" :disabled="runtime.phase === 'starting' || runtime.phase === 'closing'" @click="perform('start')">
        <span :class="['i-solar:play-bold-duotone']" aria-hidden="true" />{{ t('stage.runtime.start') }}
      </Button>
      <Button :class="['min-h-11']" size="sm" :disabled="runtime.phase === 'sleeping' || runtime.phase === 'closing'" @click="perform('close')">
        <span :class="['i-solar:moon-sleep-bold-duotone']" aria-hidden="true" />{{ t('stage.runtime.close') }}
      </Button>
      <span role="status" :class="['text-sm']">{{ t(`stage.runtime.phase.${runtime.phase}`) }}</span>
    </div>
    <ul v-if="runtime.checks.length" :class="['mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs']" :aria-label="t('stage.runtime.checks')">
      <li v-for="check in runtime.checks" :key="check.name">
        {{ t(`stage.runtime.service.${check.name}`) }}：{{ t(`stage.runtime.check.${check.state}`) }}
      </li>
    </ul>
    <p v-if="runtime.error" role="alert" :class="['mt-2 text-xs text-orange-700 dark:text-orange-300']">
      {{ t(`stage.runtime.error.${runtime.error}`) }}
    </p>
    <p v-if="actionFailed" role="alert" :class="['mt-2 text-xs text-orange-700 dark:text-orange-300']">
      {{ t('stage.runtime.error.sync-failed') }}
    </p>
    <p v-if="!runtime.enabled && runtime.phase === 'sleeping'" :class="['mt-2 text-xs text-neutral-600 dark:text-neutral-300']">
      {{ t('stage.runtime.sleep-note') }}
    </p>
  </section>
</template>
