<script setup lang="ts">
import { Button } from '@proj-airi/ui'
import { useTimestamp } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import { useRealtimeVoiceStore } from '../../stores/modules/realtime-voice'

const voice = useRealtimeVoiceStore()
const { active, configured, status, mode, conversationStyle, deliveryPaused, continuationStatus, continuationScheduledAt, continuationDelaySeconds, continuationError, continuationFailure, continuationRequests, slowBrainConfigured, slowBrainCapabilities, tasks, errorCode, userTranscript, assistantTranscript } = storeToRefs(voice)
const now = useTimestamp({ interval: 1000 })
const waitingSeconds = computed(() => continuationScheduledAt.value ? Math.max(0, Math.ceil((continuationScheduledAt.value - now.value) / 1000)) : continuationDelaySeconds.value)
const { t, te } = useI18n()
const editingTask = ref('')
const objective = ref('')
const expanded = ref(false)
const deliveryLabel = computed(() => {
  if (conversationStyle.value === 'chatty')
    return deliveryPaused.value ? 'settings.realtime.brain.chatty.resume' : 'settings.realtime.brain.chatty.pause'
  return deliveryPaused.value ? 'settings.realtime.brain.resumeDelivery' : 'settings.realtime.brain.pauseDelivery'
})

async function reviseTask() {
  const task = tasks.value.find(item => item.task_id === editingTask.value)
  if (task && await voice.reviseTask(task, objective.value))
    editingTask.value = ''
}
onMounted(() => {
  void voice.refreshConfig()
})
onUnmounted(() => voice.stop())
</script>

<template>
  <section :class="['pointer-events-auto mx-3 mb-2 max-w-xl rounded-2xl p-3', 'bg-white/85 shadow-sm backdrop-blur-md dark:bg-neutral-900/85']" :aria-label="t('settings.realtime.title')">
    <div :class="['flex flex-wrap items-center gap-3']">
      <span :class="['i-solar:phone-calling-rounded-bold-duotone', 'text-primary-500']" aria-hidden="true" />
      <span :class="['text-sm font-medium']">{{ t('settings.realtime.brain.title') }}</span>
      <Button v-if="!active" size="sm" :disabled="!configured" @click="voice.start()">
        {{ t('settings.realtime.start') }}
      </Button>
      <Button v-if="!active" size="sm" :disabled="!slowBrainConfigured" @click="voice.start('text')">
        {{ t('settings.realtime.brain.startText') }}
      </Button>
      <Button v-else size="sm" @click="voice.stop()">
        {{ t('settings.realtime.stop') }}
      </Button>
      <Button v-if="status === 'listening'" size="sm" @click="voice.interrupt()">
        {{ t('settings.realtime.interrupt') }}
      </Button>
      <Button v-if="active && mode === 'voice'" size="sm" @click="deliveryPaused ? voice.resumeDelivery() : voice.pauseDelivery()">
        {{ t(deliveryLabel) }}
      </Button>
      <RouterLink to="/settings/modules/realtime-voice" :class="['text-xs underline', 'text-primary-700 dark:text-primary-300']">
        {{ t('settings.realtime.configure') }}
      </RouterLink>
      <span v-if="active" role="status" :class="['text-xs']">{{ t(status === 'listening' && mode === 'text' ? 'settings.realtime.brain.textMode' : `settings.realtime.status.${status}`) }}</span>
      <Button size="sm" :aria-expanded="expanded" @click="expanded = !expanded">
        {{ t(expanded ? 'settings.realtime.brain.collapse' : 'settings.realtime.brain.expand') }}{{ tasks.length ? ` (${tasks.length})` : '' }}
      </Button>
    </div>
    <p v-if="deliveryPaused && conversationStyle !== 'chatty'" role="status" :class="['mt-2 text-xs', 'text-neutral-600 dark:text-neutral-300']">
      {{ t('settings.realtime.brain.deliveryPaused') }}
    </p>
    <p v-if="active && conversationStyle === 'chatty'" role="status" :class="['mt-2 text-xs', 'text-neutral-600 dark:text-neutral-300']">
      {{ t(`settings.realtime.brain.chatty.${continuationStatus}`, { seconds: waitingSeconds }) }}
      <span v-if="continuationFailure"> {{ t(`settings.realtime.brain.chatty.failure.${continuationFailure.code}`, { status: continuationFailure.httpStatus, seconds: Math.round(continuationFailure.elapsedMs / 1000) }) }}</span>
      <span v-if="mode === 'voice' && slowBrainConfigured"> · {{ t('settings.realtime.brain.chatty.budget', { count: continuationRequests }) }}</span>
      <Button v-if="continuationError && !deliveryPaused" size="sm" @click="voice.resumeDelivery()">
        {{ t('settings.realtime.brain.chatty.retry') }}
      </Button>
      <RouterLink v-if="continuationError" to="/settings/modules/consciousness" :class="['ml-1 underline']">
        {{ t('settings.realtime.brain.configureSlow') }}
      </RouterLink>
    </p>
    <div v-show="expanded" :class="['max-h-[55dvh] overflow-y-auto']">
      <p :class="['mt-2 text-xs', 'text-neutral-600 dark:text-neutral-300']">
        {{ t(slowBrainConfigured ? 'settings.realtime.brain.ready' : 'settings.realtime.brain.unconfigured') }}
        <RouterLink v-if="!slowBrainConfigured" to="/settings/modules/consciousness" :class="['ml-1 underline', 'text-primary-700 dark:text-primary-300']">
          {{ t('settings.realtime.brain.configureSlow') }}
        </RouterLink>
      </p>
      <p role="status" :class="['mt-1 text-xs', 'text-neutral-600 dark:text-neutral-300']">
        {{ t(slowBrainConfigured ? `settings.realtime.brain.search.${slowBrainCapabilities.web_search}` : 'settings.realtime.brain.search.unconfigured') }}
        <RouterLink to="/settings/modules/web-search" :class="['ml-1 underline', 'text-primary-700 dark:text-primary-300']">
          {{ t('settings.realtime.brain.configureSearch') }}
        </RouterLink>
      </p>
      <ul v-if="tasks.length" :class="['mt-3 max-h-48 overflow-auto', 'flex flex-col gap-2']" :aria-label="t('settings.realtime.brain.tasks')">
        <li v-for="task in tasks" :key="task.task_id" :class="['rounded-xl p-2', 'bg-neutral-100 dark:bg-neutral-800']">
          <div :class="['flex items-start justify-between gap-2']">
            <p :class="['min-w-0 break-words text-sm']">
              {{ task.objective }}
            </p>
            <Button v-if="task.status !== 'cancelled' && task.delivery !== 'delivered' && task.delivery !== 'context_only'" size="sm" @click="voice.cancelTask(task)">
              {{ t('settings.realtime.brain.cancel') }}
            </Button>
            <Button v-if="task.status !== 'cancelled'" size="sm" @click="editingTask = task.task_id; objective = task.objective">
              {{ t('settings.realtime.brain.revise') }}
            </Button>
          </div>
          <form v-if="editingTask === task.task_id" :class="['mt-2 flex flex-col gap-2']" @submit.prevent="reviseTask">
            <textarea v-model="objective" :aria-label="t('settings.realtime.brain.revise')" maxlength="2000" :class="['w-full rounded-lg p-2 text-sm', 'bg-white dark:bg-neutral-900']" />
            <Button size="sm" :disabled="!objective.trim()" type="submit">
              {{ t('settings.realtime.brain.saveRevision') }}
            </Button>
          </form>
          <p role="status" :class="['mt-1 text-xs', 'text-neutral-600 dark:text-neutral-300']">
            {{ t(`settings.realtime.brain.taskStatus.${task.status}`) }} · {{ t('settings.realtime.brain.version', { version: task.task_version }) }}
            <span v-if="task.result"> · {{ t(`settings.realtime.brain.delivery.${task.delivery}`) }}</span>
          </p>
          <p v-if="task.status === 'queued' || task.status === 'running'" :class="['mt-1 text-xs', 'text-neutral-600 dark:text-neutral-300']">
            {{ t(`settings.realtime.brain.progress.${task.progress.stage}`) }}
          </p>
          <p v-if="task.result" :class="['mt-1 break-words text-sm']">
            {{ task.result.result_summary }}
          </p>
          <ul v-if="task.result?.evidence.length" :class="['mt-1 text-xs', 'text-neutral-600 dark:text-neutral-300']" :aria-label="t('settings.realtime.brain.evidence')">
            <li v-for="(item, index) in task.result.evidence" :key="index">
              {{ item.source }}
            </li>
          </ul>
        </li>
      </ul>
      <div v-if="active" :class="['mt-2 max-h-28 overflow-auto', 'text-sm text-neutral-600 dark:text-neutral-300']" aria-live="polite">
        <p v-if="userTranscript">
          {{ t('settings.realtime.you') }}{{ userTranscript }}
        </p>
        <p v-if="assistantTranscript">
          {{ assistantTranscript }}
        </p>
      </div>
    </div>
    <p v-if="errorCode" role="alert" :class="['mt-2 text-xs', 'text-red-600 dark:text-red-300']">
      {{ t(te(`settings.realtime.errors.${errorCode}`) ? `settings.realtime.errors.${errorCode}` : 'settings.realtime.errors.connection') }}
    </p>
  </section>
</template>
