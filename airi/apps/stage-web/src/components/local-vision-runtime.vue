<script setup lang="ts">
import { usePiniaSynced } from '@proj-airi/stage-ui/libs/pinia'
import { registerLocalVisionContext } from '@proj-airi/stage-ui/services/local-vision-context'
import { useChatStore } from '@proj-airi/stage-ui/stores/chat'
import { useCompanionStore } from '@proj-airi/stage-ui/stores/companion'
import { useLocalVisionStore } from '@proj-airi/stage-ui/stores/local-vision'
import { useRealtimeVoiceStore } from '@proj-airi/stage-ui/stores/modules/realtime-voice'
import { useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings/audio-device'
import { useStageIdentityStore } from '@proj-airi/stage-ui/stores/stage-identity'
import { useStageRuntimeStore } from '@proj-airi/stage-ui/stores/stage-runtime'
import { Button } from '@proj-airi/ui'
import { computed, onScopeDispose, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute } from 'vue-router'

const local = useLocalVisionStore()
const companion = useCompanionStore()
const chat = useChatStore()
const identity = useStageIdentityStore()
const runtime = useStageRuntimeStore()
const voice = useRealtimeVoiceStore()
const audio = useSettingsAudioDevice()
const leadership = usePiniaSynced()
const route = useRoute()
const { t } = useI18n()
const actor = computed(() => local.result?.snapshot.payload.actors.find(actor => actor.primary))
const clearProjection = registerLocalVisionContext({ project: sessionId => local.project(sessionId), scope: sessionId => local.projectScope(sessionId) })
local.owner = leadership.isLeader()
const stopLeadership = leadership.onLeadershipChange((leader) => {
  local.owner = leader
})
// Every renderer releases its local devices when the leader publishes sleep.
watch(() => runtime.enabled, (enabled) => {
  if (!enabled) {
    companion.cancel()
    voice.stop()
    local.stop()
    audio.stopStream()
  }
}, { flush: 'sync', immediate: true })
watch(() => identity.userId, async () => {
  try {
    await chat.cancelPendingSends()
  }
  catch {
    // Renderer teardown also cancels the synchronized channel. Session ownership still rejects old turns.
  }
}, { flush: 'sync' })
const timer = setInterval(() => {
  // Perception has its own clock. Waiting for microphone permission or a model reply must not stop camera recovery.
  void local.maintain()
  if (runtime.enabled)
    void companion.tick()
}, 250)
onScopeDispose(() => {
  clearInterval(timer)
  clearProjection()
  stopLeadership()
  companion.cancel()
  local.stop()
})
</script>

<template>
  <aside v-if="route.path === '/'" :class="['fixed bottom-3 left-3 z-50 max-w-xs', 'flex flex-col gap-2 rounded-xl p-3 shadow-md', 'bg-neutral-50/95 dark:bg-neutral-900/95']">
    <Button size="sm" :disabled="!runtime.enabled" :aria-pressed="local.mode === 'active'" @click="local.setMode(local.mode === 'active' ? 'passive' : 'active')">
      {{ t(`settings.local-vision.mode-${local.mode}`) }} · {{ t('settings.local-vision.switch-mode') }}
    </Button>
    <RouterLink to="/settings/modules/vision" :class="['text-xs']">
      {{ t(`settings.local-vision.status.${local.status}`) }} · {{ t('settings.local-vision.settings') }}
    </RouterLink>
    <p v-if="runtime.enabled && local.health?.ready" :class="['text-xs']">
      {{ t('settings.local-vision.models-ready', { device: local.health.device }) }}
    </p>
    <p v-if="local.active" role="status" :class="['text-xs']">
      {{ t('settings.local-vision.frames', { count: local.processedFrames }) }}
      · {{ t('settings.local-vision.people-count', { count: local.result?.snapshot.payload.actors.length ?? 0 }) }}
    </p>
    <p v-if="actor" role="status" :class="['text-xs']">
      {{ actor.display_name || t('base.guest.name') }} · {{ t(`settings.local-vision.identity.${actor.identity_status}`) }}
    </p>
    <p v-if="local.result" role="status" :class="['text-xs']">
      {{ t(`settings.local-vision.recognition.${local.recognitionReason}`) }}
      <span v-if="local.result.recognition?.reason === 'collecting'"> · {{ t('settings.local-vision.confirmation-progress', { count: local.result.recognition.samples }) }}</span>
    </p>
    <p v-if="runtime.enabled && local.error" role="alert" :class="['text-xs text-orange-600 dark:text-orange-300']">
      {{ t(`settings.local-vision.errors.${local.error}`) }}
    </p>
    <p v-if="local.result?.adaptation?.tracking || local.result?.adaptation?.state === 'learned'" role="status" :class="['text-xs']">
      {{ t(`settings.local-vision.adaptation.${local.result.adaptation.state}`, { count: local.result.adaptation.candidates, saved: local.result.adaptation.saved }) }}
    </p>
    <Button v-if="runtime.enabled && local.mode === 'active' && !local.active && local.status !== 'starting'" size="sm" @click="local.setMode('active')">
      {{ t('settings.local-vision.retry') }}
    </Button>
    <p v-if="companion.thinking" role="status" :class="['text-xs']">
      {{ t('settings.local-vision.thinking') }}
    </p>
    <RouterLink v-if="!companion.modelReady" to="/settings/providers" :class="['text-xs']">
      {{ t('settings.local-vision.models-needed') }}
    </RouterLink>
    <p v-if="local.learning?.learning" role="status" :class="['text-xs']">
      {{ t('settings.local-vision.learning', { name: local.learning.name, count: local.learning.samples }) }}
    </p>
    <p v-if="local.greeting" role="status" :class="['text-sm']">
      {{ local.greeting.text }}
    </p>
  </aside>
</template>
