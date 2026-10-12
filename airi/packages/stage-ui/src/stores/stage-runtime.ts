import type {} from 'pinia-plugin-synced'

import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import * as v from 'valibot'

import { useChatStore } from './chat'
import { useChatSessionStore } from './chat/session-store'
import { useCompanionStore } from './companion'
import { useLocalVisionStore } from './local-vision'
import { useConsciousnessStore } from './modules/consciousness'
import { useRealtimeVoiceStore } from './modules/realtime-voice'
import { useSettingsAudioDevice } from './settings/audio-device'
import { useSpeechOutputControlStore } from './speech-output-control'

const hostReplySchema = v.object({ vision: v.picklist(['ready', 'stopped', 'busy', 'unavailable']) })
type CheckState = 'ready' | 'unconfigured' | 'unavailable' | 'busy' | 'stopped'
interface RuntimeCheck { name: 'vision' | 'voice' | 'text' | 'history', state: CheckState }

/**
 * The elected renderer owns start/sleep. Only serializable status crosses windows.
 * Preferences survive sleep; a generation fences late checks and permission requests.
 * The web gateway stays available so settings and a later start remain reachable.
 */
export const useStageRuntimeStore = defineStore('stage-runtime', () => {
  // Synced actions own persistence. Storage-event proposals could overwrite the leader's phase with a follower's stale snapshot.
  const awake = useStorage('settings/stage/awake', true, undefined, { listenToStorageChanges: false })
  const phase = ref<'running' | 'starting' | 'closing' | 'sleeping'>(awake.value ? 'running' : 'sleeping')
  const checks = ref<RuntimeCheck[]>([])
  const error = ref('')
  const enabled = computed<boolean>(() => awake.value && phase.value === 'running')
  let generation = 0

  async function host(action: 'wake' | 'sleep'): Promise<v.InferOutput<typeof hostReplySchema>> {
    const response = await fetch(`/api/stage-runtime/${action}`, {
      method: 'POST',
      headers: { 'x-airi-runtime': '1' },
      signal: AbortSignal.timeout(70000),
    })
    if (!response.ok)
      throw new Error('runtime-unavailable')
    return v.parse(hostReplySchema, await response.json())
  }

  async function release(): Promise<void> {
    // Stop producers before cancelling queued outputs. Settings and archives keep their stores.
    useCompanionStore().cancel()
    useRealtimeVoiceStore().stop()
    useLocalVisionStore().stop()
    useSettingsAudioDevice().stopStream()
    useSpeechOutputControlStore().requestStopSpeaking('manual-all')
    await useChatStore().cancelPendingSends()
  }

  /** Checks existing services without issuing a paid model completion or altering credentials. */
  async function start(): Promise<boolean> {
    if (phase.value === 'starting' || phase.value === 'closing')
      return false
    const current = ++generation
    awake.value = true
    phase.value = 'starting'
    checks.value = []
    error.value = ''
    try {
      await release()
      if (current !== generation)
        return false
      const vision = await host('wake').catch(() => ({ vision: 'unavailable' as const }))
      if (current !== generation)
        return false
      checks.value = [{ name: 'vision', state: vision.vision }]
      const voice = useRealtimeVoiceStore()
      const gateway = await voice.refreshConfig()
      if (current !== generation)
        return false
      checks.value.push({ name: 'voice', state: gateway ? voice.configured ? 'ready' : 'unconfigured' : 'unavailable' })
      const text = useConsciousnessStore()
      checks.value.push({ name: 'text', state: text.activeProvider && (text.activeModel || text.activeProvider === 'prompt-api') ? 'ready' : 'unconfigured' })
      try {
        await useChatSessionStore().initialize()
        await useChatSessionStore().activateCurrentUser()
        if (current !== generation)
          return false
        checks.value.push({ name: 'history', state: 'ready' })
      }
      catch {
        if (current !== generation)
          return false
        checks.value.push({ name: 'history', state: 'unavailable' })
      }
      phase.value = 'running'
      // An explicit start retries immediately; the capture recovery backoff belongs to unattended retries.
      const local = useLocalVisionStore()
      local.setMode(local.mode)
      return true
    }
    catch {
      if (current === generation) {
        awake.value = false
        phase.value = 'sleeping'
        error.value = 'start-failed'
      }
      return false
    }
  }

  /** Sleep invalidates an in-flight start before releasing browser and server resources. */
  async function close(): Promise<void> {
    if (phase.value === 'closing')
      return
    const current = ++generation
    awake.value = false
    phase.value = 'closing'
    error.value = ''
    try {
      await release()
    }
    catch {
      error.value = 'release-failed'
    }
    // The host serializes wake/sleep, so a cancelled cold start cannot resurrect its process.
    const result = await host('sleep').catch(() => ({ vision: 'unavailable' as const }))
    if (current !== generation)
      return
    checks.value = [{ name: 'vision', state: result.vision }]
    if (result.vision === 'unavailable')
      error.value = 'sleep-failed'
    phase.value = 'sleeping'
  }

  return { awake, phase, enabled, checks, error, start, close }
}, { synced: { state: true, actions: ['start', 'close'] } })
