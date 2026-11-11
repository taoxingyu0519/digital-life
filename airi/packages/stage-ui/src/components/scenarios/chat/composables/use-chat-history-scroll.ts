import type { Ref } from 'vue'

import { useEventListener, useResizeObserver } from '@vueuse/core'
import { computed, ref, watch } from 'vue'

interface ChatHistoryScrollOptions<TMessage> {
  container: Readonly<Ref<HTMLElement | null>>
  messages: Readonly<Ref<TMessage[]>>
  scrollToIndex: (index: number, align: 'start' | 'end') => void
  /** Cancels an index request that is still waiting for virtualizer measurement. */
  cancelScroll?: () => void
  /** Space that a floating composer covers at the end of the viewport. */
  tailInset: Readonly<Ref<number>>
  /** Reflow settings can change item height without adding a message. */
  layout?: Readonly<Ref<unknown>>
}

/**
 * Follows new messages and content growth by default. Upward wheel, touch,
 * keyboard, or scrollbar input releases the lock. Reaching the tail or clicking
 * the latest-message action restores it. Hover, focus, and selection do not release it.
 */
export function useChatHistoryScroll<TMessage>({
  container,
  messages,
  scrollToIndex,
  cancelScroll,
  tailInset,
  layout,
}: ChatHistoryScrollOptions<TMessage>) {
  let isFollowingConversation = true
  let previousContainer: HTMLElement | null = null
  let previousScrollTop = 0
  let touchPosition: { x: number, y: number } | undefined
  const showLatest = ref(false)

  function scrollToLatest() {
    const lastIndex = messages.value.length - 1
    if (lastIndex < 0)
      return
    isFollowingConversation = true
    showLatest.value = false
    scrollToIndex(lastIndex, 'end')
  }

  const isNearTail = (currentContainer: HTMLElement) => {
    // NOTICE: This tolerance absorbs sub-pixel layout changes, font swaps, and late content growth.
    return currentContainer.scrollTop + currentContainer.clientHeight >= currentContainer.scrollHeight - 24
  }

  function releaseTail() {
    const currentContainer = container.value
    if (!currentContainer || currentContainer.scrollHeight <= currentContainer.clientHeight)
      return
    isFollowingConversation = false
    showLatest.value = true
    previousScrollTop = currentContainer.scrollTop
    // A queued index request can otherwise run after the gesture and pull the reader back.
    cancelScroll?.()
  }

  useEventListener(container, 'scroll', () => {
    const currentContainer = container.value
    if (!currentContainer)
      return
    const atTail = isNearTail(currentContainer)
    // An upward gesture can still be within the tail tolerance. Only movement back down restores the lock.
    if (atTail && currentContainer.scrollTop > previousScrollTop)
      isFollowingConversation = true
    showLatest.value = !atTail || !isFollowingConversation
    previousScrollTop = currentContainer.scrollTop
  }, { passive: true })

  useEventListener(container, 'wheel', (event) => {
    if (event.deltaY < 0 && Math.abs(event.deltaY) >= Math.abs(event.deltaX))
      releaseTail()
  }, { passive: true })

  useEventListener(container, 'touchstart', (event) => {
    const touch = event.touches[0]
    touchPosition = touch ? { x: touch.clientX, y: touch.clientY } : undefined
  }, { passive: true })
  useEventListener(container, 'touchmove', (event) => {
    const touch = event.touches[0]
    if (touch && touchPosition) {
      const dy = touch.clientY - touchPosition.y
      if (dy > 0 && dy > Math.abs(touch.clientX - touchPosition.x))
        releaseTail()
      touchPosition = { x: touch.clientX, y: touch.clientY }
    }
  }, { passive: true })
  useEventListener(container, ['touchend', 'touchcancel'], () => {
    touchPosition = undefined
  }, { passive: true })

  useEventListener(container, 'keydown', (event) => {
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]'))
      return
    if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey))
      releaseTail()
  })

  // Reka's vertical scrollbar is a sibling of the viewport. Capture the gesture before it changes scrollTop.
  const scrollSurface = computed(() => container.value?.parentElement)
  useEventListener(scrollSurface, ['pointerdown', 'pointermove'], (event) => {
    if (event.buttons === 1 && event.target instanceof Element && event.target.closest('.scrollable-area-scrollbar--vertical'))
      releaseTail()
  }, { capture: true, passive: true })

  function alignFollowingTail() {
    const currentContainer = container.value
    const lastIndex = messages.value.length - 1
    if (!currentContainer || lastIndex < 0)
      return
    showLatest.value = !isNearTail(currentContainer) || !isFollowingConversation
    if (isFollowingConversation)
      scrollToIndex(lastIndex, 'end')
  }

  // The content wrapper grows during streaming, image loading, and virtualizer measurement without a new message ID.
  const content = computed(() => {
    const element = container.value?.firstElementChild
    return element instanceof HTMLElement ? element : undefined
  })
  useResizeObserver(() => [container.value, content.value], alignFollowingTail)

  watch(
    [container, messages, tailInset, () => layout?.value],
    ([currentContainer, currentMessages]) => {
      if (currentContainer !== previousContainer) {
        previousContainer = currentContainer
        previousScrollTop = currentContainer?.scrollTop ?? 0
        isFollowingConversation = true
        touchPosition = undefined
        showLatest.value = false
      }
      if (!currentContainer || currentMessages.length === 0) {
        cancelScroll?.()
        isFollowingConversation = true
        showLatest.value = false
        return
      }
      alignFollowingTail()
    },
    { flush: 'post', immediate: true },
  )

  return { showLatest, scrollToLatest }
}
