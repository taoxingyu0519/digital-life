import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

/** Speech activity covers utterances and pending ASR, not the enabled state of the microphone. */
export const useVoiceActivityStore = defineStore('voice-activity', () => {
  const recording = ref(false)
  const transcribing = ref(false)
  const busy = computed(() => recording.value || transcribing.value)
  return { recording, transcribing, busy }
})
