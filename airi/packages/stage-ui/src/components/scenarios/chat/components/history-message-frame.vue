<script setup lang="ts">
import type { ChatHistoryItem } from '../../../../types/chat'
import type { SwipeableSlotProps } from '../../../gestures'

import { useElementVisibility } from '@vueuse/core'
import { computed, onMounted, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWebHaptics } from 'web-haptics/vue'

import { useStageIdentityStore } from '../../../../stores/stage-identity'
import { Swipeable } from '../../../gestures'

const props = withDefaults(defineProps<{
  scrollContainer?: HTMLElement | null
  variant?: 'desktop' | 'mobile'
  replyEnabled?: boolean
  archive?: ChatHistoryItem['archive']
  role?: ChatHistoryItem['role']
}>(), {
  replyEnabled: false,
  scrollContainer: null,
  variant: 'desktop',
})

const emit = defineEmits<{
  reply: []
}>()

const messageRef = useTemplateRef<HTMLDivElement>('message')
const scrollTarget = computed(() => props.scrollContainer)
const isVisible = useElementVisibility(messageRef, {
  initialValue: false,
  scrollTarget,
})

const { trigger: triggerHaptic } = useWebHaptics()
const identity = useStageIdentityStore()
const { t } = useI18n()
const archiveLabel = computed(() => {
  const archive = props.archive
  if (!archive?.personId)
    return props.role === 'user' || props.role === 'assistant' ? `${archive?.characterName || 'AIRI'}-${t('settings.chat-archive.unassigned')}` : ''
  const name = identity.names[archive.personId] || archive.displayName || `${t('base.guest.name')} · ${archive.personId.slice(0, 8)}`
  return `${archive.characterName}-${name}`
})
onMounted(() => {
  void identity.loadNames().catch(() => {
    // The message's saved name remains usable when the optional name directory cannot be read.
  })
})

function getReplyIconStyle(swipe: SwipeableSlotProps) {
  const offset = Math.abs(swipe.offset)
  // The icon moves at 18% of the bubble distance, with a 10-pixel cap.
  const iconOffset = -Math.min(offset * 0.18, 10)
  return {
    opacity: swipe.progress,
    // Scale from 72% to full size as the pointer reaches the reply threshold.
    transform: `translate3d(${iconOffset}px, -50%, 0) scale(${0.72 + swipe.progress * 0.28})`,
  }
}
</script>

<template>
  <div
    ref="message"
    :class="[
      'chat-message-item relative',
      'opacity-0 transition-opacity duration-200 ease-out motion-reduce:transition-none',
      isVisible ? 'chat-message-item-visible opacity-100' : '',
      variant === 'mobile' ? 'pb-1' : 'pb-2',
    ]"
  >
    <p v-if="archiveLabel" :data-archive-person="archive?.personId" :class="['mb-0.5 truncate text-[10px] leading-tight text-neutral-500 dark:text-neutral-400', role === 'user' && variant === 'desktop' ? 'text-right' : 'text-left']">
      {{ archiveLabel }}
    </p>
    <Swipeable
      v-slot="swipe"
      :enabled="replyEnabled"
      :input="variant === 'mobile' ? 'touch' : 'wheel'"
      @commit="emit('reply')"
      @threshold-enter="triggerHaptic('medium')"
    >
      <div
        v-if="replyEnabled"
        aria-hidden="true"
        :class="[
          'pointer-events-none absolute top-1/2 z-0 size-8',
          'flex items-center justify-center rounded-full',
          'bg-primary-100/85 text-primary-600 shadow-sm backdrop-blur-sm',
          'dark:bg-primary-900/80 dark:text-primary-200',
          'right-1',
        ]"
        :style="getReplyIconStyle(swipe)"
      >
        <div class="i-solar:reply-bold-duotone size-4" />
      </div>
      <div
        data-swipeable-surface
        :data-swipe-active="swipe.active"
        :class="[
          'relative z-1',
          swipe.active ? 'select-none' : '',
        ]"
        :style="{
          transform: `translate3d(${swipe.offset}px, 0, 0)`,
          willChange: swipe.active ? 'transform' : undefined,
        }"
      >
        <slot />
      </div>
    </Swipeable>
  </div>
</template>
