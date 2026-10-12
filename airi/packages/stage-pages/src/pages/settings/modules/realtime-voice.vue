<script setup lang="ts">
import type { ContinuationFailure } from '@proj-airi/realtime-voice/conversation'

import BrainPromptEditor from '@proj-airi/stage-ui/components/scenarios/brain-prompt-editor.vue'

import { ContinuationError, conversationPolicy } from '@proj-airi/realtime-voice/conversation'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useRealtimeVoiceStore } from '@proj-airi/stage-ui/stores/modules/realtime-voice'
import { useSlowBrainStore } from '@proj-airi/stage-ui/stores/modules/slow-brain'
import { Button, FieldCheckbox, FieldInput, FieldRange, FieldSelect } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

const { t, te } = useI18n()
const voice = useRealtimeVoiceStore()
const { config, configured, active, useForText, conversationStyle, continuationDelaySeconds, slowBrainConfigured, errorCode, requestId } = storeToRefs(voice)
const styleOptions = computed(() => voice.conversationStyles.map(value => ({ value, label: t(`settings.realtime.brain.styles.${value}`) })))
const apiKey = ref('')
const model = ref(config.value.model)
const speaker = ref(config.value.voice)
const resource = ref(config.value.resourceId)
const busy = ref(false)
const saved = ref(false)
const slowBrain = useSlowBrainStore()
const sessions = useChatSessionStore()
const testing = ref(false)
const testSpeech = ref('')
const testFailure = shallowRef<ContinuationFailure>()
let testController: AbortController | undefined
let testTimer: ReturnType<typeof setTimeout> | undefined

async function testContinuation() {
  if (testing.value || active.value || !slowBrainConfigured.value)
    return
  testing.value = true
  testSpeech.value = ''
  testFailure.value = undefined
  const controller = new AbortController()
  testController = controller
  const startedAt = Date.now()
  testTimer = setTimeout(() => {
    testFailure.value = { code: 'timeout', elapsedMs: Date.now() - startedAt }
    controller.abort()
    testing.value = false
    testController = undefined
  }, conversationPolicy('chatty').continuation!.timeoutMs)
  try {
    // This explicit diagnostic shares the production request path, with no chat history or voice session.
    const text = await slowBrain.composeContinuation(sessions.activeSessionId, [], controller.signal, { phase: 'opening', unanswered_segments: 0, remaining_probe_opportunities: 2 })
    if (testController === controller && !controller.signal.aborted)
      testSpeech.value = text
  }
  catch (error) {
    if (testController === controller && !controller.signal.aborted)
      testFailure.value = { code: error instanceof ContinuationError ? error.code : 'generation', elapsedMs: Date.now() - startedAt, ...(error instanceof ContinuationError && error.httpStatus ? { httpStatus: error.httpStatus } : {}) }
  }
  finally {
    if (testController === controller) {
      clearTimeout(testTimer)
      testController = undefined
      testing.value = false
    }
  }
}

async function load() {
  busy.value = true
  await voice.refreshConfig()
  model.value = config.value.model
  speaker.value = config.value.voice
  resource.value = config.value.resourceId
  busy.value = false
}

async function save() {
  busy.value = true
  saved.value = false
  const ok = await voice.saveConfig({ apiKey: apiKey.value, model: model.value, voice: speaker.value, resourceId: resource.value })
  apiKey.value = ''
  saved.value = ok
  busy.value = false
}

async function remove() {
  busy.value = true
  saved.value = false
  try {
    await voice.resetState()
  }
  catch { /* The store presents the configuration error. */ }
  apiKey.value = ''
  busy.value = false
}

onMounted(load)
onUnmounted(() => {
  clearTimeout(testTimer)
  testController?.abort()
  testController = undefined
})
</script>

<template>
  <div :class="['mx-auto max-w-3xl', 'flex flex-col gap-6']">
    <section :class="['rounded-2xl p-5', 'bg-primary-100/50 dark:bg-primary-950/30']">
      <div :class="['mb-2 flex items-center gap-2', 'text-lg font-semibold']">
        <span :class="['i-solar:phone-calling-rounded-bold-duotone']" aria-hidden="true" />
        {{ t('settings.realtime.provider') }}
      </div>
      <p :class="['text-sm leading-relaxed']">
        {{ t('settings.realtime.explanation') }}
      </p>
      <p :class="['mt-3 text-sm leading-relaxed']">
        {{ t('settings.realtime.integration') }}
      </p>
      <p :class="['mt-3 text-sm leading-relaxed']">
        {{ t('settings.realtime.scope') }}
      </p>
    </section>

    <section :class="['rounded-2xl border p-5', 'border-neutral-200 dark:border-neutral-800']">
      <h2 :class="['mb-3 text-lg font-semibold']">
        {{ t('settings.realtime.brain.title') }}
      </h2>
      <FieldCheckbox v-model="useForText" :label="t('settings.realtime.brain.useForText')" :description="t('settings.realtime.brain.textHelp')" :disabled="active" />
      <FieldSelect v-model="conversationStyle" :class="['mt-5']" :label="t('settings.realtime.brain.style')" :description="t('settings.realtime.brain.styleHelp')" :options="styleOptions" />
      <p :class="['mt-3 text-sm leading-relaxed']">
        {{ t('settings.realtime.brain.personaHelp') }}
      </p>
      <RouterLink to="/settings/airi-card" :class="['mt-2 inline-block text-sm underline', 'text-primary-700 dark:text-primary-300']">
        {{ t('settings.realtime.brain.configurePersona') }}
      </RouterLink>
      <p v-if="conversationStyle === 'chatty'" :class="['mt-3 text-sm leading-relaxed']">
        {{ t('settings.realtime.brain.chatty.help') }}
      </p>
      <div v-if="conversationStyle === 'chatty'" :class="['mt-3 flex flex-col items-start gap-2']">
        <FieldRange v-model="continuationDelaySeconds" :class="['w-full']" :min="1" :max="120" :step="1" :label="t('settings.realtime.brain.chatty.delay')" :description="t('settings.realtime.brain.chatty.delayHelp')" :format-value="value => t('settings.realtime.brain.chatty.seconds', { seconds: value })" />
        <div :class="['flex gap-2']">
          <Button v-for="seconds in [5, 10]" :key="seconds" size="sm" :aria-pressed="continuationDelaySeconds === seconds" @click="continuationDelaySeconds = seconds">
            {{ t('settings.realtime.brain.chatty.seconds', { seconds }) }}
          </Button>
        </div>
        <p :class="['my-2 text-xs leading-relaxed']">
          {{ t('settings.realtime.brain.chatty.reflectionHelp') }}
        </p>
        <Button size="sm" :disabled="testing || active || !slowBrainConfigured" @click="testContinuation">
          {{ t(`settings.realtime.brain.chatty.${testing ? 'preparing' : 'test'}`) }}
        </Button>
        <p :class="['text-xs leading-relaxed']">
          {{ t('settings.realtime.brain.chatty.testHelp') }}
        </p>
        <p v-if="testSpeech" role="status" :class="['text-sm leading-relaxed']">
          {{ t('settings.realtime.brain.chatty.testSuccess') }} {{ testSpeech }}
        </p>
        <p v-if="testFailure" role="alert" :class="['text-sm', 'text-red-600 dark:text-red-300']">
          {{ t(`settings.realtime.brain.chatty.failure.${testFailure.code}`, { status: testFailure.httpStatus, seconds: Math.round(testFailure.elapsedMs / 1000) }) }}
        </p>
      </div>
      <p role="status" :class="['mt-4 text-sm']">
        {{ t(slowBrainConfigured ? 'settings.realtime.brain.ready' : 'settings.realtime.brain.unconfigured') }}
      </p>
      <p :class="['mt-2 text-sm leading-relaxed']">
        {{ t('settings.realtime.brain.slowHelp') }}
      </p>
      <RouterLink to="/settings/modules/consciousness" :class="['mt-3 inline-block text-sm underline', 'text-primary-700 dark:text-primary-300']">
        {{ t('settings.realtime.brain.configureSlow') }}
      </RouterLink>
    </section>

    <BrainPromptEditor />

    <form :class="['flex flex-col gap-5', 'rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800']" @submit.prevent="save">
      <p role="status" :class="['text-sm']">
        {{ t(configured ? 'settings.realtime.keySaved' : 'settings.realtime.noKey') }}
      </p>
      <FieldInput v-model="apiKey" type="password" autocomplete="new-password" :disabled="busy || active" :label="t('settings.realtime.apiKey')" :description="t('settings.realtime.keyHelp')" :placeholder="t(configured ? 'settings.realtime.keepKey' : 'settings.realtime.enterKey')" />
      <FieldInput v-model="model" :disabled="busy || active" :label="t('settings.realtime.model')" required />
      <FieldInput v-model="speaker" :disabled="busy || active" :label="t('settings.realtime.voice')" required />
      <FieldInput v-model="resource" :disabled="busy || active" :label="t('settings.realtime.resource')" required />
      <div :class="['flex flex-wrap gap-3']">
        <Button type="submit" variant="primary" :disabled="busy || active || (!configured && !apiKey.trim())">
          {{ t('settings.realtime.save') }}
        </Button>
        <Button type="button" :disabled="busy || active || !configured" @click="remove">
          {{ t('settings.realtime.remove') }}
        </Button>
      </div>
      <p v-if="saved" role="status" :class="['text-sm text-primary-700 dark:text-primary-300']">
        {{ t('settings.realtime.saved') }}
      </p>
    </form>

    <p v-if="errorCode" role="alert" :class="['text-sm text-red-600 dark:text-red-300']">
      {{ t(te(`settings.realtime.errors.${errorCode}`) ? `settings.realtime.errors.${errorCode}` : 'settings.realtime.errors.connection') }}
      <span v-if="requestId">{{ t('settings.realtime.requestId') }}: {{ requestId }}</span>
    </p>
    <div :class="['flex flex-wrap gap-5 text-sm']">
      <RouterLink to="/" :class="['text-primary-700 underline dark:text-primary-300']">
        {{ t('settings.realtime.backToStage') }}
      </RouterLink>
      <RouterLink to="/settings/modules/hearing" :class="['text-primary-700 underline dark:text-primary-300']">
        {{ t('settings.realtime.microphoneSettings') }}
      </RouterLink>
      <a href="https://docs.volcengine.com/docs/DoubaoVoice/endtoend-realtime-voice-full-duplex-version?lang=zh" target="_blank" rel="noopener noreferrer" :class="['text-primary-700 underline dark:text-primary-300']">{{ t('settings.realtime.docs') }}</a>
    </div>
    <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
      {{ t('settings.realtime.privacy') }}
    </p>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.realtime.title
  subtitleKey: settings.title
</route>
