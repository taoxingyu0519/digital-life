<script setup lang="ts">
import type { VoiceInputBinding } from '@proj-airi/stage-ui/libs/audio/voice-input-binding'

import Header from '@proj-airi/stage-layouts/components/Layouts/Header.vue'
import InteractiveArea from '@proj-airi/stage-layouts/components/Layouts/InteractiveArea.vue'
import MobileInteractiveArea from '@proj-airi/stage-layouts/components/Layouts/MobileInteractiveArea.vue'
import RealtimeVoiceControls from '@proj-airi/stage-ui/components/scenarios/realtime-voice-controls.vue'
import StageRuntimeControls from '@proj-airi/stage-ui/components/scenarios/stage-runtime-controls.vue'
import workletUrl from '@proj-airi/stage-ui/workers/vad/process.worklet?worker&url'

import { BackgroundProvider } from '@proj-airi/stage-layouts/components/Backgrounds'
import { useBackgroundThemeColor } from '@proj-airi/stage-layouts/composables/theme-color'
import { useBackgroundStore } from '@proj-airi/stage-layouts/stores/background'
import { HoloCoupon } from '@proj-airi/stage-ui/components'
import { ViewControlSlider, WidgetStage } from '@proj-airi/stage-ui/components/scenes'
import { useAudioRecorder } from '@proj-airi/stage-ui/composables/audio/audio-recorder'
import { useFaceGaze } from '@proj-airi/stage-ui/composables/vision/use-face-gaze'
import { createVoiceInputBinding } from '@proj-airi/stage-ui/libs/audio/voice-input-binding'
import { useVAD } from '@proj-airi/stage-ui/stores/ai/models/vad'
import { useChatStore } from '@proj-airi/stage-ui/stores/chat'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useHearingSpeechInputPipeline } from '@proj-airi/stage-ui/stores/modules/hearing'
import { useRealtimeVoiceStore } from '@proj-airi/stage-ui/stores/modules/realtime-voice'
import { useSettings, useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings'
import { useStageRuntimeStore } from '@proj-airi/stage-ui/stores/stage-runtime'
import { useVoiceActivityStore } from '@proj-airi/stage-ui/stores/voice-activity'
import { breakpointsTailwind, useBreakpoints } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref, shallowRef, useTemplateRef, watch } from 'vue'

const paused = ref(false)
const runtime = useStageRuntimeStore()

function handleSettingsOpen(open: boolean) {
  paused.value = open
}

const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('md')
const stageViewport = shallowRef({ height: 0, offsetTop: 0 })
// NOTICE:
// Why: A fixed Stage follows Safari's input pan and moves Live2D with the keyboard.
// Root cause: Safari moves the Visual Viewport before the page receives the new offsetTop value.
// Source: https://bugs.webkit.org/show_bug.cgi?id=265578
// Removal condition: Safari keeps fixed content stable during the input pan.
const stageSurfaceStyle = computed(() => isMobile.value
  ? {
      position: 'fixed' as const,
      inset: '0',
      height: stageViewport.value.height > 0 ? `${stageViewport.value.height}px` : '100dvh',
      transform: `translate3d(0, ${stageViewport.value.offsetTop}px, 0)`,
      willChange: 'transform',
    }
  : undefined)

const backgroundStore = useBackgroundStore()
const { selectedOption, sampledColor } = storeToRefs(backgroundStore)
const backgroundSurface = useTemplateRef<InstanceType<typeof BackgroundProvider>>('backgroundSurface')
const { stageModelRenderer } = storeToRefs(useSettings())

const { syncBackgroundTheme } = useBackgroundThemeColor({ backgroundSurface, selectedOption, sampledColor })
onMounted(() => syncBackgroundTheme())

// Audio + transcription pipeline (mirrors stage-tamagotchi)
const settingsAudioDeviceStore = useSettingsAudioDevice()
const { stream, enabled } = storeToRefs(settingsAudioDeviceStore)
const { discardRecord, startRecord, stopRecord, onStopRecord, isRecording } = useAudioRecorder(stream)
const voiceActivity = useVoiceActivityStore()
watch(isRecording, value => voiceActivity.recording = value, { flush: 'sync' })
const hearingPipeline = useHearingSpeechInputPipeline()
const { releaseStreamingTranscriptionConsumer, transcribeForMediaStream, transcribeForRecording } = hearingPipeline
const { supportsStreamInput } = storeToRefs(hearingPipeline)
const consciousnessStore = useConsciousnessStore()
const { activeProvider: activeChatProvider, activeModel: activeChatModel, activeTemperature, activeTopP } = storeToRefs(consciousnessStore)
const chatStore = useChatStore()
const { active: realtimeActive } = storeToRefs(useRealtimeVoiceStore())

/** Identifies this page in the shared streaming transcription session. */
const transcriptionConsumerId = 'stage-web:voice-input'

const {
  init: initVAD,
  dispose: disposeVAD,
  start: startVAD,
  loaded: vadLoaded,
  inferenceError: vadError,
} = useVAD(workletUrl, {
  threshold: ref(0.6),
  onSpeechStart: () => handleSpeechStart(),
  onSpeechEnd: () => handleSpeechEnd(),
  onSpeechCancel: () => handleSpeechCancel(),
})

let stopOnStopRecord: (() => void) | undefined
let currentBinding: VoiceInputBinding | undefined

async function sendVoiceInputTextToChat(text: string | undefined) {
  if (realtimeActive.value || !text?.trim())
    return

  try {
    const providerId = activeChatProvider.value
    const model = activeChatModel.value
    if (!providerId || !model)
      return

    const provider = await consciousnessStore.getChatProviderInstance(providerId)

    await chatStore.ingest(text, {
      model,
      chatProvider: provider,
      temperature: activeTemperature.value,
      topP: activeTopP.value,
    })
  }
  catch (error) {
    console.error('Failed to send chat from voice:', error)
  }
}

async function startAudioInteraction(binding: VoiceInputBinding) {
  currentBinding = binding
  if (binding.mode === 'stream') {
    await transcribeForMediaStream(binding.stream, {
      consumerId: transcriptionConsumerId,
      onSentenceEnd: (text) => {
        if (currentBinding === binding)
          void sendVoiceInputTextToChat(text)
      },
    })
    if (hearingPipeline.error)
      throw new Error(hearingPipeline.error)
    return
  }

  await initVAD()
  if (!vadLoaded.value)
    throw new Error(vadError.value || 'Failed to initialize voice activity detection.')
  if (currentBinding !== binding)
    return
  await startVAD(binding.stream)

  stopOnStopRecord = onStopRecord(async (recording) => {
    voiceActivity.transcribing = true
    try {
      const text = await transcribeForRecording(recording)
      if (currentBinding === binding)
        await sendVoiceInputTextToChat(text)
    }
    finally { voiceActivity.transcribing = false }
  })
}

async function handleSpeechStart() {
  if (currentBinding?.mode === 'recording')
    await startRecord()
}

async function handleSpeechEnd() {
  if (currentBinding?.mode === 'recording')
    await stopRecord()
}

async function handleSpeechCancel() {
  if (currentBinding?.mode === 'recording')
    await discardRecord()
}

async function stopAudioInteraction() {
  voiceActivity.recording = false
  voiceActivity.transcribing = false
  currentBinding = undefined
  stopOnStopRecord?.()
  stopOnStopRecord = undefined
  disposeVAD()
  await discardRecord()
  await releaseStreamingTranscriptionConsumer(transcriptionConsumerId)
}

const voiceInputBinding = createVoiceInputBinding({
  start: startAudioInteraction,
  stop: stopAudioInteraction,
})

watch([enabled, stream, supportsStreamInput, realtimeActive, () => runtime.enabled], ([isEnabled, currentStream, supportsStream, inCall, running]) => {
  const binding: VoiceInputBinding | undefined = running && !inCall && isEnabled && currentStream
    ? { stream: currentStream, mode: supportsStream ? 'stream' : 'recording' }
    : undefined
  void voiceInputBinding.update(binding).catch((error) => {
    console.error('Audio interaction failed:', error)
  })
}, { immediate: true })

onUnmounted(() => {
  void voiceInputBinding.update().catch(error => console.error('Failed to stop audio interaction:', error))
})

const gazePosition = useFaceGaze()
</script>

<template>
  <BackgroundProvider
    ref="backgroundSurface"
    :class="['widgets top-widgets']"
    :background="selectedOption"
    :style="stageSurfaceStyle"
    :top-color="sampledColor"
  >
    <div
      data-testid="mobile-stage-content"
      :class="[
        'relative z-2 h-full w-100vw overflow-hidden md:h-100dvh',
        'flex flex-col',
      ]"
    >
      <!-- header -->
      <div :class="['w-full gap-2', 'px-0 py-1 md:px-3 md:py-3']">
        <Header :class="['hidden md:flex']" />
      </div>
      <div data-testid="realtime-voice-overlay" :class="['pointer-events-none absolute inset-x-0 top-[max(4rem,env(safe-area-inset-top))] z-30']">
        <StageRuntimeControls />
        <RealtimeVoiceControls v-show="runtime.enabled" />
      </div>
      <!-- page -->
      <div :class="['relative flex flex-1 flex-row <md:flex-col', 'gap-y-0 gap-x-2']">
        <div :class="['relative flex-1 min-w-1/2']">
          <div
            :class="[
              'absolute left-0 z-15 px-3',
              stageModelRenderer === 'live2d' ? 'top-0 h-full py-[20vh]' : 'top-1/2 -translate-y-1/2',
            ]"
          >
            <ViewControlSlider />
          </div>
          <WidgetStage
            :class="['h-full w-full']"
            :gaze-position="paused ? undefined : gazePosition"
            :enable-orbit-controls="!isMobile"
            :paused="paused || !runtime.enabled"
          />
        </div>
        <InteractiveArea
          v-if="!isMobile"
          :class="['absolute right-4 h-85dvh max-w-500px min-w-30%', 'flex flex-1 flex-col']"
        />
      </div>
      <HoloCoupon />
    </div>
    <Teleport to="body">
      <MobileInteractiveArea
        v-if="isMobile"
        @settings-open="handleSettingsOpen"
        @stage-viewport-change="stageViewport = $event"
      />
    </Teleport>
  </BackgroundProvider>
</template>

<route lang="yaml">
name: IndexScenePage
meta:
  layout: stage
  stageTransition:
    name: bubble-wave-out
</route>
