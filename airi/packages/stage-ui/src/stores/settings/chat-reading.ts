import type { CSSProperties } from 'vue'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { computed } from 'vue'

const defaults = { fontSize: 18, bubbleSize: 2 }

/** Reading preferences belong to this browser, independently of people, accounts, and model settings. */
export const useSettingsChatReading = defineStore('settings-chat-reading', () => {
  const fontSize = useLocalStorageManualReset('settings/chat/font-size', defaults.fontSize)
  const bubbleSize = useLocalStorageManualReset('settings/chat/bubble-size', defaults.bubbleSize)
  const historyStyle = computed<CSSProperties>(() => ({
    '--chat-message-font-size': `${fontSize.value}px`,
    '--chat-bubble-max-width': `${70 + bubbleSize.value * 7.5}%`,
    '--chat-bubble-padding': `${6 + bubbleSize.value * 2}px ${8 + bubbleSize.value * 2}px`,
  }))

  function changeFontSize(direction: number) {
    fontSize.value = Math.min(30, Math.max(14, fontSize.value + direction * 2))
  }

  function changeBubbleSize(direction: number) {
    bubbleSize.value = Math.min(4, Math.max(0, bubbleSize.value + direction))
  }

  function resetState() {
    // A reloaded manual-reset ref remembers the saved value. This action restores the declared reading defaults.
    fontSize.value = defaults.fontSize
    bubbleSize.value = defaults.bubbleSize
  }

  return { fontSize, bubbleSize, historyStyle, changeFontSize, changeBubbleSize, resetState }
})
