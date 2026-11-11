<script setup lang="ts">
import { BasicButton } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { useI18n } from 'vue-i18n'

import { useSettingsChatReading } from '../../../../stores/settings/chat-reading'

withDefaults(defineProps<{ variant?: 'desktop' | 'mobile' }>(), { variant: 'desktop' })
const reading = useSettingsChatReading()
const { fontSize, bubbleSize } = storeToRefs(reading)
const { t } = useI18n()
const prefix = 'stage.chat.reading.'
const adjustmentClass = ['size-9 shrink-0 rounded-lg text-lg', 'bg-neutral-100 hover:bg-primary-100 disabled:opacity-40 dark:bg-neutral-800 dark:hover:bg-primary-900', 'focus-visible:outline-2 focus-visible:outline-primary-500']
</script>

<template>
  <PopoverRoot>
    <PopoverTrigger as-child>
      <BasicButton
        size="unset"
        :class="[
          'shrink-0 rounded-lg text-base font-semibold outline-none',
          'text-neutral-600 hover:bg-primary-100/60 dark:text-neutral-300 dark:hover:bg-primary-900/40',
          'focus-visible:outline-2 focus-visible:outline-primary-500',
          variant === 'mobile' ? 'pointer-events-auto size-11 rounded-full bg-neutral-50/70 backdrop-blur-md dark:bg-neutral-900/70' : 'size-8',
        ]"
        :title="t(`${prefix}title`)"
        :aria-label="t(`${prefix}title`)"
      >
        <span aria-hidden="true">Aa</span>
      </BasicButton>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        side="bottom"
        align="end"
        :side-offset="8"
        :collision-padding="8"
        :aria-label="t(`${prefix}title`)"
        :class="[
          'z-[10010] w-[min(17rem,calc(100vw-1rem))] flex flex-col gap-3 rounded-xl border p-3 shadow-lg backdrop-blur-md',
          'border-neutral-200/60 bg-neutral-50/95 text-neutral-800 dark:border-neutral-800/40 dark:bg-neutral-900/95 dark:text-neutral-100',
        ]"
      >
        <div :class="['flex items-center justify-between gap-2']">
          <span :class="['text-sm font-medium']">{{ t(`${prefix}font`) }}</span>
          <div :class="['flex items-center gap-2']">
            <BasicButton size="unset" :class="adjustmentClass" :disabled="fontSize <= 14" :aria-label="t(`${prefix}font-decrease`)" @click="reading.changeFontSize(-1)">
              −
            </BasicButton>
            <output :class="['min-w-12 text-center text-sm tabular-nums']" aria-live="polite">{{ fontSize }}px</output>
            <BasicButton size="unset" :class="adjustmentClass" :disabled="fontSize >= 30" :aria-label="t(`${prefix}font-increase`)" @click="reading.changeFontSize(1)">
              +
            </BasicButton>
          </div>
        </div>
        <div :class="['flex items-center justify-between gap-2']">
          <span :class="['text-sm font-medium']">{{ t(`${prefix}bubble`) }}</span>
          <div :class="['flex items-center gap-2']">
            <BasicButton size="unset" :class="adjustmentClass" :disabled="bubbleSize <= 0" :aria-label="t(`${prefix}bubble-decrease`)" @click="reading.changeBubbleSize(-1)">
              −
            </BasicButton>
            <output :class="['min-w-12 text-center text-sm']" aria-live="polite">{{ t(`${prefix}bubble-${bubbleSize}`) }}</output>
            <BasicButton size="unset" :class="adjustmentClass" :disabled="bubbleSize >= 4" :aria-label="t(`${prefix}bubble-increase`)" @click="reading.changeBubbleSize(1)">
              +
            </BasicButton>
          </div>
        </div>
        <BasicButton size="unset" :class="['self-end rounded-lg px-2 py-1 text-sm text-primary-600 hover:bg-primary-100 dark:text-primary-300 dark:hover:bg-primary-900', 'focus-visible:outline-2 focus-visible:outline-primary-500']" @click="reading.resetState()">
          {{ t(`${prefix}reset`) }}
        </BasicButton>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
