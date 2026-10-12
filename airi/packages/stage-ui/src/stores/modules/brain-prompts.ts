import type { BrainPromptSettings } from '@proj-airi/realtime-voice/prompts'

import { brainPromptDefaults, brainPromptSchema } from '@proj-airi/realtime-voice/prompts'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { computed } from 'vue'

import * as v from 'valibot'

/** Browser-origin settings. Complete saved snapshots feed all three model request paths. */
export const useBrainPromptsStore = defineStore('brain-prompts', () => {
  const stored = useLocalStorageManualReset('settings/realtime-voice/brain-prompts', structuredClone(brainPromptDefaults), { deep: true })
  const parsed = computed(() => v.safeParse(brainPromptSchema, stored.value))
  // Invalid user-edited storage is displayed by the editor. Valid defaults keep model requests bounded until repaired.
  const config = computed(() => parsed.value.success ? parsed.value.output : brainPromptDefaults)
  const invalidStored = computed(() => !parsed.value.success)
  const revision = computed(() => JSON.stringify(config.value))

  function save(input: BrainPromptSettings) {
    stored.value = v.parse(brainPromptSchema, input)
  }

  function reset() {
    save(structuredClone(brainPromptDefaults))
  }

  return { config, invalidStored, revision, save, reset }
})
