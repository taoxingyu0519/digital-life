<script setup lang="ts">
import { errorMessageFrom } from '@moeru/std'
import { conversationStyleSchema } from '@proj-airi/realtime-voice/conversation'
import { brainPromptDefaults, brainPromptSchema } from '@proj-airi/realtime-voice/prompts'
import { Button, FieldInput } from '@proj-airi/ui'
import { computed, ref, toRaw, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import * as v from 'valibot'

import { useBrainPromptsStore } from '../../stores/modules/brain-prompts'
import { useRealtimeVoiceStore } from '../../stores/modules/realtime-voice'
import { useSlowBrainStore } from '../../stores/modules/slow-brain'

const { t } = useI18n()
const prompts = useBrainPromptsStore()
const voice = useRealtimeVoiceStore()
const slowBrain = useSlowBrainStore()
const draft = ref(structuredClone(toRaw(prompts.config)))
const saved = ref(false)
const saveError = ref('')
const style = computed(() => v.parse(conversationStyleSchema, voice.conversationStyle))
const valid = computed(() => v.safeParse(brainPromptSchema, draft.value).success)
const dirty = computed(() => JSON.stringify(draft.value) !== prompts.revision)

watch(() => prompts.revision, () => {
  draft.value = structuredClone(toRaw(prompts.config))
})
watch(draft, () => {
  if (dirty.value)
    saved.value = false
}, { deep: true })

function save() {
  saveError.value = ''
  try {
    prompts.save(draft.value)
    saved.value = true
  }
  catch (error) {
    saveError.value = errorMessageFrom(error) ?? t('settings.realtime.brain.prompts.invalid')
  }
}

function restore() {
  draft.value = structuredClone(brainPromptDefaults)
  saved.value = false
  saveError.value = ''
}
</script>

<template>
  <section :class="['rounded-2xl border p-5', 'border-neutral-200 dark:border-neutral-800', 'flex flex-col gap-5']">
    <div>
      <h2 :class="['mb-2 text-lg font-semibold']">
        {{ t('settings.realtime.brain.prompts.title') }}
      </h2>
      <p :class="['text-sm leading-relaxed', 'text-neutral-600 dark:text-neutral-300']">
        {{ t('settings.realtime.brain.prompts.help') }}
      </p>
    </div>
    <FieldInput v-model="draft.fast" :single-line="false" input-class="min-h-64 resize-y" :label="t('settings.realtime.brain.prompts.fast')" :description="t('settings.realtime.brain.prompts.fastHelp')" />
    <FieldInput v-model="draft.slow" :single-line="false" input-class="min-h-48 resize-y" :label="t('settings.realtime.brain.prompts.slow')" :description="t('settings.realtime.brain.prompts.slowHelp')" />
    <details :class="['rounded-xl border p-4', 'border-neutral-200 dark:border-neutral-800']">
      <summary :class="['cursor-pointer text-sm font-medium']">
        {{ t('settings.realtime.brain.prompts.more') }}
      </summary>
      <div :class="['mt-5 flex flex-col gap-5']">
        <FieldInput v-model="draft.result" :single-line="false" input-class="min-h-48 resize-y" :label="t('settings.realtime.brain.prompts.result')" :description="t('settings.realtime.brain.prompts.resultHelp')" />
        <FieldInput v-model="draft.continuation" :single-line="false" input-class="min-h-64 resize-y" :label="t('settings.realtime.brain.prompts.continuation')" :description="t('settings.realtime.brain.prompts.continuationHelp')" />
        <FieldInput v-model="draft.core" :single-line="false" input-class="min-h-48 resize-y" :label="t('settings.realtime.brain.prompts.core')" :description="t('settings.realtime.brain.prompts.coreHelp')" />
        <FieldInput v-model="draft.styles[style]" :single-line="false" input-class="min-h-48 resize-y" :label="t('settings.realtime.brain.prompts.style', { style: t(`settings.realtime.brain.styles.${style}`) })" :description="t('settings.realtime.brain.prompts.styleHelp')" :disabled="style === 'basic'" />
      </div>
    </details>
    <p v-if="!valid || prompts.invalidStored || saveError" role="alert" :class="['text-sm text-red-600 dark:text-red-400']">
      {{ t('settings.realtime.brain.prompts.invalid') }}
    </p>
    <p v-if="voice.active" :class="['text-sm text-neutral-600 dark:text-neutral-300']">
      {{ t('settings.realtime.brain.prompts.active') }}
    </p>
    <div :class="['flex flex-wrap items-center gap-3']">
      <Button :disabled="voice.active || !valid || (!dirty && !prompts.invalidStored)" @click="save">
        {{ t('settings.realtime.brain.prompts.save') }}
      </Button>
      <Button variant="secondary" @click="restore">
        {{ t('settings.realtime.brain.prompts.restore') }}
      </Button>
      <span v-if="saved" role="status" :class="['text-sm text-primary-700 dark:text-primary-300']">
        {{ t('settings.realtime.brain.prompts.saved') }}
      </span>
      <span v-else-if="dirty" :class="['text-sm text-neutral-600 dark:text-neutral-300']">
        {{ t('settings.realtime.brain.prompts.unsaved') }}
      </span>
    </div>
    <details :class="['rounded-xl border p-4', 'border-neutral-200 dark:border-neutral-800']">
      <summary :class="['cursor-pointer text-sm font-medium']">
        {{ t('settings.realtime.brain.prompts.preview') }}
      </summary>
      <p :class="['my-3 text-xs', 'text-neutral-600 dark:text-neutral-300']">
        {{ t('settings.realtime.brain.prompts.previewHelp') }}
      </p>
      <h3 :class="['mb-2 text-sm font-medium']">
        {{ t('settings.realtime.brain.prompts.fast') }}
      </h3>
      <pre :class="['max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg p-3 text-xs', 'bg-neutral-50 dark:bg-neutral-950']">{{ voice.systemInstructions }}</pre>
      <h3 :class="['mb-2 mt-4 text-sm font-medium']">
        {{ t('settings.realtime.brain.prompts.slow') }}
      </h3>
      <pre :class="['max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg p-3 text-xs', 'bg-neutral-50 dark:bg-neutral-950']">{{ slowBrain.systemInstructions }}</pre>
    </details>
  </section>
</template>
