<script setup lang="ts">
import type { VirtualizerHandle } from 'virtua/vue'

import type { ChatToolCallRerunEvent, ToolCallRerunRequest } from '../../../../stores/tool-call-rerun'
import type { ChatHistoryItem, StreamingAssistantMessage } from '../../../../types/chat'
import type { ChatHistoryReplyPayload } from '../reply'
import type { ChatToolCallRendererRegistry } from './tool-call-renderer'

import { BasicButton } from '@proj-airi/ui'
import { Virtualizer } from 'virtua/vue'
import { computed, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import ChatAssistantItem from './assistant-item.vue'
import ChatHistoryScrollContainer from './chat-history-scroll-container.vue'
import ChatErrorItem from './error-item.vue'
import ChatHistoryMessageFrame from './history-message-frame.vue'
import ChatUserItem from './user-item.vue'

import { useSettingsChatReading } from '../../../../stores/settings/chat-reading'
import { useChatHistoryScroll } from '../composables/use-chat-history-scroll'
import { useChatHistoryTopFade } from '../composables/use-chat-history-top-fade'
import { useVirtualizerBottomAlignment, useVirtualizerScroll } from '../composables/use-virtualizer-scroll'
import { getChatHistoryItemCopyText, getChatHistoryItemKey, mergeChatHistory } from '../utils'

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(defineProps<{
  messages: ChatHistoryItem[]
  /** Call-local captions are visible before persistence, with mutation actions disabled. */
  liveMessages?: ChatHistoryItem[]
  streamingMessage?: StreamingAssistantMessage
  sending?: boolean
  assistantLabel?: string
  userLabel?: string
  errorLabel?: string
  retryLabel?: string
  /** Space that a floating composer covers at the end of the scroll viewport. */
  tailInset?: number
  variant?: 'desktop' | 'mobile'
  /**
   * How the bubbles paint their backgrounds. `opaque` is for hosts with
   * nothing behind the history, such as a transparent window over the
   * desktop, where translucent bubbles take the contrast of whatever is under
   * them.
   */
  surface?: 'translucent' | 'opaque'
  /**
   * When the scrollbar shows: while scrolling, or also while the pointer is
   * over the history. A host that passes clicks through the empty history
   * uses `hover`, so a scrollbar the wheel cannot reveal still appears.
   */
  scrollbar?: 'scroll' | 'hover'
  toolCallRenderers?: ChatToolCallRendererRegistry
}>(), {
  sending: false,
  tailInset: 0,
  variant: 'desktop',
  surface: 'translucent',
  scrollbar: 'scroll',
  toolCallRenderers: () => ({}),
})

const emit = defineEmits<{
  (e: 'copyMessage', payload: { message: ChatHistoryItem, index: number, key: string | number }): void
  (e: 'deleteMessage', payload: { message: ChatHistoryItem, index: number, key: string | number }): void
  (e: 'replyMessage', payload: ChatHistoryReplyPayload): void
  (e: 'retryMessage', payload: { message: ChatHistoryItem, index: number, key: string | number }): void
  (e: 'toolCallRerun', payload: ChatToolCallRerunEvent): void
}>()

/** Keeps about two mobile viewports ready so fast flicks do not expose an unmounted gap. */
const CHAT_HISTORY_OVERSCAN = 600

const scrollContainerRef = useTemplateRef<InstanceType<typeof ChatHistoryScrollContainer>>('scroll-container')
const chatHistoryRef = computed<HTMLElement | null>(() => scrollContainerRef.value?.viewport ?? null)
const virtualizerRef = useTemplateRef<VirtualizerHandle>('virtualizer')
const tailInset = computed(() => props.tailInset)
const { scrollToIndex, cancelScroll } = useVirtualizerScroll({
  container: chatHistoryRef,
  tailInset,
  virtualizer: virtualizerRef,
})

const { t } = useI18n()
const reading = useSettingsChatReading()
const readingLayout = computed(() => reading.historyStyle)
const labels = computed(() => ({
  assistant: props.assistantLabel ?? t('stage.chat.message.character-name.airi'),
  user: props.userLabel ?? t('stage.chat.message.character-name.you'),
  error: props.errorLabel ?? t('stage.chat.message.character-name.core-system'),
  retry: props.retryLabel ?? t('stage.chat.actions.retry'),
}))

const emptyStreamingMessage: StreamingAssistantMessage = { role: 'assistant', content: '', slices: [], tool_results: [] }
const streaming = computed<StreamingAssistantMessage>(() => props.streamingMessage ?? emptyStreamingMessage)
const showStreamingPlaceholder = computed(() => (streaming.value.slices?.length ?? 0) === 0 && !streaming.value.content)
const emptyLiveMessages: ChatHistoryItem[] = []
const liveIds = computed(() => new Set(props.liveMessages?.flatMap(message => message.id ? [message.id] : [])))
function isLiveMessage(message: ChatHistoryItem) {
  return !!message.id && liveIds.value.has(message.id)
}
function shouldShowPlaceholder(message: ChatHistoryItem) {
  return !!streaming.value.id && message.id === streaming.value.id
}
function canReplyToMessage(message: ChatHistoryItem) {
  if (!message.id || isLiveMessage(message))
    return false

  if (message.role !== 'assistant' && message.role !== 'user')
    return false

  if (message.role === 'assistant' && shouldShowPlaceholder(message) && showStreamingPlaceholder.value)
    return false

  return getChatHistoryItemCopyText(message).trim().length > 0
}
const renderMessages = computed<ChatHistoryItem[]>(() => {
  const messages = mergeChatHistory(props.messages, props.liveMessages ?? emptyLiveMessages)
  if (!props.sending)
    return messages

  const streamId = streaming.value.id
  if (!streamId)
    return messages

  const hasStreamAlready = messages.some(message => message.role === 'assistant' && message.id === streamId)
  if (hasStreamAlready)
    return messages

  return [...messages, streaming.value]
})
function canRetryMessageAt(index: number) {
  const precedingMessage = renderMessages.value[index - 1]
  if (precedingMessage?.role === 'user')
    return true

  if (precedingMessage?.role === 'assistant' && precedingMessage.interrupted)
    return renderMessages.value[index - 2]?.role === 'user'

  return false
}
const messagesById = computed(() => new Map(
  renderMessages.value.flatMap(message => message.id ? [[message.id, message] as const] : []),
))
const renderMessageCount = computed(() => renderMessages.value.length)
const topFadeRatio = computed(() => props.variant === 'mobile' ? 0.2 : 0)

const { itemProps } = useVirtualizerBottomAlignment({
  container: chatHistoryRef,
  itemCount: renderMessageCount,
  virtualizer: virtualizerRef,
})

const { showLatest, scrollToLatest } = useChatHistoryScroll({
  container: chatHistoryRef,
  messages: renderMessages,
  scrollToIndex,
  cancelScroll,
  tailInset,
  layout: readingLayout,
})
useChatHistoryTopFade({
  container: chatHistoryRef,
  fadeRatio: topFadeRatio,
})

function emitCopyMessage(message: ChatHistoryItem, index: number) {
  emit('copyMessage', {
    message,
    index,
    key: getChatHistoryItemKey(message, index),
  })
}

function emitDeleteMessage(message: ChatHistoryItem, index: number) {
  if (isLiveMessage(message))
    return
  emit('deleteMessage', {
    message,
    index,
    key: getChatHistoryItemKey(message, index),
  })
}

function emitRetryMessage(message: ChatHistoryItem, index: number) {
  emit('retryMessage', {
    message,
    index,
    key: getChatHistoryItemKey(message, index),
  })
}

function emitReplyMessage(message: ChatHistoryItem) {
  if (!canReplyToMessage(message))
    return

  emit('replyMessage', {
    message,
    label: message.role === 'assistant' ? labels.value.assistant : labels.value.user,
  })
}

function getReplyTarget(message: ChatHistoryItem): ChatHistoryReplyPayload | undefined {
  if (!message.replyToMessageId)
    return undefined

  const target = messagesById.value.get(message.replyToMessageId)
  if (!target || (target.role !== 'assistant' && target.role !== 'user'))
    return undefined

  return {
    label: target.role === 'assistant' ? labels.value.assistant : labels.value.user,
    message: target,
  }
}

/**
 * Triggering workflow: ChatAssistantItem `toolCallRerun` -> emitToolCallRerun
 * -> the parent runtime's tool rerun handler, with this message location.
 */
function emitToolCallRerun(
  message: ChatHistoryItem,
  index: number,
  payload: ToolCallRerunRequest,
) {
  emit('toolCallRerun', {
    message,
    index,
    key: getChatHistoryItemKey(message, index),
    ...payload,
  })
}
</script>

<template>
  <div
    v-bind="$attrs"
    :style="reading.historyStyle"
    :class="['relative h-full w-full']"
  >
    <ChatHistoryScrollContainer
      ref="scroll-container"
      :variant="variant"
      :scrollbar="scrollbar"
    >
      <Virtualizer
        ref="virtualizer"
        :data="renderMessages"
        :buffer-size="CHAT_HISTORY_OVERSCAN"
        :item-props="itemProps"
        :scroll-ref="chatHistoryRef ?? undefined"
      >
        <template #default="{ item: message, index }">
          <ChatHistoryMessageFrame
            :key="getChatHistoryItemKey(message, index)"
            :archive="message.archive"
            :role="message.role"
            :variant="variant"
            :scroll-container="chatHistoryRef"
            :reply-enabled="canReplyToMessage(message)"
            @reply="emitReplyMessage(message)"
          >
            <ChatErrorItem
              v-if="message.role === 'error'"
              :message="message"
              :label="labels.error"
              :retry-label="labels.retry"
              :can-retry="canRetryMessageAt(index)"
              :show-placeholder="sending && index === renderMessages.length - 1"
              :scroll-container="chatHistoryRef"
              :variant="variant"
              :surface="surface"
              @copy="emitCopyMessage(message, index)"
              @retry="emitRetryMessage(message, index)"
              @delete="emitDeleteMessage(message, index)"
            />
            <ChatAssistantItem
              v-else-if="message.role === 'assistant'"
              :message="message"
              :label="labels.assistant"
              :reply-target="getReplyTarget(message)"
              :can-reply="canReplyToMessage(message)"
              :can-delete="!isLiveMessage(message)"
              :show-placeholder="shouldShowPlaceholder(message) && showStreamingPlaceholder"
              :scroll-container="chatHistoryRef"
              :variant="variant"
              :surface="surface"
              :tool-call-renderers="toolCallRenderers"
              @copy="emitCopyMessage(message, index)"
              @delete="emitDeleteMessage(message, index)"
              @reply="emitReplyMessage(message)"
              @tool-call-rerun="emitToolCallRerun(message, index, $event)"
            />
            <ChatUserItem
              v-else-if="message.role === 'user'"
              :message="message"
              :label="labels.user"
              :reply-target="getReplyTarget(message)"
              :can-reply="canReplyToMessage(message)"
              :can-delete="!isLiveMessage(message)"
              :scroll-container="chatHistoryRef"
              :variant="variant"
              :surface="surface"
              @copy="emitCopyMessage(message, index)"
              @delete="emitDeleteMessage(message, index)"
              @reply="emitReplyMessage(message)"
            />
          </ChatHistoryMessageFrame>
        </template>
      </Virtualizer>
    </ChatHistoryScrollContainer>
    <BasicButton
      v-if="showLatest"
      size="unset"
      :class="[
        'absolute bottom-3 right-3 z-30 flex items-center gap-1 rounded-full border px-3 py-2 text-sm shadow-md backdrop-blur-md',
        'border-primary-200/70 bg-neutral-50/95 text-primary-700 dark:border-primary-800/70 dark:bg-neutral-900/95 dark:text-primary-200',
        'focus-visible:outline-2 focus-visible:outline-primary-500',
      ]"
      @click="scrollToLatest"
    >
      <span aria-hidden="true" :class="['i-solar:alt-arrow-down-outline size-4']" />
      {{ t('stage.chat.reading.latest') }}
    </BasicButton>
  </div>
</template>

<style scoped>
:deep(.chat-message-item-container) {
  font-size: var(--chat-message-font-size);
  line-height: 1.6;
  max-width: var(--chat-bubble-max-width);
  padding: var(--chat-bubble-padding);
}
</style>
