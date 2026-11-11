import type { EffectScope, ShallowRef } from 'vue'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import { useChatHistoryScroll } from './use-chat-history-scroll'

interface TestMessage {
  id: string
}

const activeScopes: EffectScope[] = []

function createScrollContainer(messageCount: number) {
  const container = document.createElement('div')
  container.style.height = '120px'
  container.style.overflowY = 'auto'
  container.style.width = '320px'
  replaceMessageItems(container, messageCount)
  document.body.appendChild(container)
  return container
}

function replaceMessageItems(container: HTMLElement, messageCount: number) {
  const items = Array.from({ length: messageCount }, (_, index) => {
    const item = document.createElement('div')
    item.className = 'chat-message-item'
    item.style.height = '120px'
    item.tabIndex = 0
    item.textContent = `Message ${index}`
    return item
  })
  container.replaceChildren(...items)
}

function startScrollBehavior({
  container,
  messages,
  scrollToIndex,
  tailInset = shallowRef(0),
  layout = shallowRef(0),
  cancelScroll,
}: {
  container: ShallowRef<HTMLElement | null>
  messages: ShallowRef<TestMessage[]>
  scrollToIndex: (index: number, align: 'start' | 'end') => void
  tailInset?: ShallowRef<number>
  layout?: ShallowRef<number>
  cancelScroll?: () => void
}) {
  const scope = effectScope()
  activeScopes.push(scope)
  return scope.run(() => {
    return useChatHistoryScroll({
      container,
      messages,
      scrollToIndex,
      cancelScroll,
      tailInset,
      layout,
    })
  })!
}

async function flushReactivity() {
  await nextTick()
  await Promise.resolve()
}

afterEach(() => {
  for (const scope of activeScopes)
    scope.stop()
  activeScopes.length = 0
  document.body.replaceChildren()
  document.getSelection()?.removeAllRanges()
})

describe('useChatHistoryScroll', () => {
  // ROOT CAUSE:
  //
  // Persisted history can hydrate after the scroll container mounts. Marking the
  // initial scroll as complete while the list is empty leaves the restored history
  // at its first message instead of the live edge.
  //
  // The initial request now waits until both the container and one message exist.
  it('requests the restored history tail after delayed hydration', async () => {
    const container = shallowRef<HTMLElement | null>(null)
    const messages = shallowRef<TestMessage[]>([])
    const scrollToIndex = vi.fn()
    startScrollBehavior({ container, messages, scrollToIndex })

    await flushReactivity()
    expect(scrollToIndex).not.toHaveBeenCalled()

    container.value = createScrollContainer(2)
    messages.value = [{ id: 'user-1' }, { id: 'assistant-1' }]
    await flushReactivity()

    expect(scrollToIndex).toHaveBeenCalledWith(1, 'end')
  })

  it('aligns a new tail message to the viewport end', async () => {
    const currentContainer = createScrollContainer(2)
    currentContainer.scrollTop = currentContainer.scrollHeight
    const container = shallowRef<HTMLElement | null>(currentContainer)
    const messages = shallowRef<TestMessage[]>([{ id: 'user-1' }, { id: 'assistant-1' }])
    const scrollToIndex = vi.fn()
    startScrollBehavior({ container, messages, scrollToIndex })
    await flushReactivity()
    scrollToIndex.mockClear()

    replaceMessageItems(currentContainer, 3)
    messages.value = [...messages.value, { id: 'assistant-2' }]
    await flushReactivity()

    expect(scrollToIndex).toHaveBeenCalledTimes(1)
    expect(scrollToIndex).toHaveBeenCalledWith(2, 'end')
  })

  // http://127.0.0.1:5174 — AIRI-047: only manual scrolling can release the default tail lock.
  // ROOT CAUSE: Hover, focus, and selection blocked scrolling. Only manual upward input now releases the lock, and content resizing keeps it aligned.
  it('aIRI-047 keeps following while the pointer rests on an older message', async () => {
    const currentContainer = createScrollContainer(2)
    currentContainer.scrollTop = currentContainer.scrollHeight
    const container = shallowRef<HTMLElement | null>(currentContainer)
    const messages = shallowRef<TestMessage[]>([{ id: 'user-1' }, { id: 'assistant-1' }])
    const scrollToIndex = vi.fn()
    startScrollBehavior({ container, messages, scrollToIndex })
    await flushReactivity()
    scrollToIndex.mockClear()

    currentContainer.firstElementChild?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
    replaceMessageItems(currentContainer, 3)
    messages.value = [...messages.value, { id: 'assistant-2' }]
    await flushReactivity()

    expect(scrollToIndex).toHaveBeenCalledWith(2, 'end')
  })

  it('aIRI-047 keeps following while an older message has focus or selected text', async () => {
    const currentContainer = createScrollContainer(2)
    currentContainer.scrollTop = currentContainer.scrollHeight
    const container = shallowRef<HTMLElement | null>(currentContainer)
    const messages = shallowRef<TestMessage[]>([{ id: 'user-1' }, { id: 'assistant-1' }])
    const scrollToIndex = vi.fn()
    startScrollBehavior({ container, messages, scrollToIndex })
    await flushReactivity()
    scrollToIndex.mockClear()

    const earlier = currentContainer.firstElementChild
    if (!(earlier instanceof HTMLElement))
      throw new Error('Expected an earlier message')
    earlier.focus()
    document.getSelection()?.selectAllChildren(earlier)
    document.dispatchEvent(new Event('selectionchange'))
    messages.value = [...messages.value, { id: 'assistant-2' }]
    await flushReactivity()
    expect(scrollToIndex).toHaveBeenCalledWith(2, 'end')
  })

  it('aIRI-047 follows delayed content growth without replacing its message object', async () => {
    const currentContainer = createScrollContainer(1)
    const container = shallowRef<HTMLElement | null>(currentContainer)
    const messages = shallowRef<TestMessage[]>([{ id: 'assistant-1' }])
    const scrollToIndex = vi.fn()
    startScrollBehavior({ container, messages, scrollToIndex })
    await flushReactivity()
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    scrollToIndex.mockClear()

    const content = currentContainer.firstElementChild
    if (!(content instanceof HTMLElement))
      throw new Error('Expected message content')
    content.style.height = '400px'
    await vi.waitFor(() => expect(scrollToIndex).toHaveBeenCalledWith(0, 'end'))
  })

  it('keeps following after a layout-only scroll moves the viewport from the tail', async () => {
    const currentContainer = createScrollContainer(2)
    currentContainer.scrollTop = currentContainer.scrollHeight
    const container = shallowRef<HTMLElement | null>(currentContainer)
    const messages = shallowRef<TestMessage[]>([{ id: 'user-1' }, { id: 'assistant-1' }])
    const scrollToIndex = vi.fn()
    startScrollBehavior({ container, messages, scrollToIndex })
    await flushReactivity()
    scrollToIndex.mockClear()

    currentContainer.scrollTop = 0
    currentContainer.dispatchEvent(new Event('scroll'))
    replaceMessageItems(currentContainer, 3)
    messages.value = [...messages.value, { id: 'assistant-2' }]
    await flushReactivity()

    expect(scrollToIndex).toHaveBeenCalledWith(2, 'end')
  })

  // https://github.com/moeru-ai/airi/pull/2489#discussion_r3968140754
  // ROOT CAUSE:
  //
  // The floating composer inset was sampled only when another change requested
  // a scroll. Expanding a reply preview or attachment area changed the available
  // tail space without moving the last message above the composer.
  //
  // An inset change must request end alignment while the reader follows the tail.
  it('realigns the followed tail after the composer inset changes', async () => {
    const currentContainer = createScrollContainer(2)
    currentContainer.scrollTop = currentContainer.scrollHeight
    const container = shallowRef<HTMLElement | null>(currentContainer)
    const messages = shallowRef<TestMessage[]>([{ id: 'user-1' }, { id: 'assistant-1' }])
    const scrollToIndex = vi.fn()
    const tailInset = shallowRef(80)
    startScrollBehavior({ container, messages, scrollToIndex, tailInset })
    await flushReactivity()
    scrollToIndex.mockClear()

    tailInset.value = 144
    await flushReactivity()

    expect(scrollToIndex).toHaveBeenCalledTimes(1)
    expect(scrollToIndex).toHaveBeenCalledWith(1, 'end')
  })

  it('keeps the reader position after the composer inset changes away from the tail', async () => {
    const currentContainer = createScrollContainer(2)
    currentContainer.scrollTop = currentContainer.scrollHeight
    const container = shallowRef<HTMLElement | null>(currentContainer)
    const messages = shallowRef<TestMessage[]>([{ id: 'user-1' }, { id: 'assistant-1' }])
    const scrollToIndex = vi.fn()
    const tailInset = shallowRef(80)
    startScrollBehavior({ container, messages, scrollToIndex, tailInset })
    await flushReactivity()
    scrollToIndex.mockClear()

    currentContainer.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }))
    currentContainer.scrollTop = 0
    currentContainer.dispatchEvent(new Event('scroll'))
    tailInset.value = 144
    await flushReactivity()

    expect(scrollToIndex).not.toHaveBeenCalled()
  })

  it('stops following after a user scroll moves the viewport from the tail', async () => {
    const currentContainer = createScrollContainer(2)
    currentContainer.scrollTop = currentContainer.scrollHeight
    const container = shallowRef<HTMLElement | null>(currentContainer)
    const messages = shallowRef<TestMessage[]>([{ id: 'user-1' }, { id: 'assistant-1' }])
    const scrollToIndex = vi.fn()
    startScrollBehavior({ container, messages, scrollToIndex })
    await flushReactivity()
    scrollToIndex.mockClear()

    currentContainer.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }))
    currentContainer.scrollTop = 0
    currentContainer.dispatchEvent(new Event('scroll'))
    replaceMessageItems(currentContainer, 3)
    messages.value = [...messages.value, { id: 'assistant-2' }]
    await flushReactivity()

    expect(scrollToIndex).not.toHaveBeenCalled()
  })

  it.each(['wheel', 'keyboard', 'touch', 'scrollbar'] as const)('aIRI-047 releases on upward %s input and locks again after returning to latest', async (input) => {
    const currentContainer = createScrollContainer(3)
    currentContainer.scrollTop = currentContainer.scrollHeight
    const container = shallowRef<HTMLElement | null>(currentContainer)
    const messages = shallowRef<TestMessage[]>([{ id: 'user-1' }, { id: 'assistant-1' }, { id: 'user-2' }])
    const scrollToIndex = vi.fn()
    const cancelScroll = vi.fn()
    const following = startScrollBehavior({ container, messages, scrollToIndex, cancelScroll })
    await flushReactivity()
    scrollToIndex.mockClear()

    if (input === 'wheel') {
      currentContainer.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }))
    }
    else if (input === 'keyboard') {
      currentContainer.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp' }))
    }
    else if (input === 'touch') {
      currentContainer.dispatchEvent(new TouchEvent('touchstart', { touches: [new Touch({ identifier: 1, target: currentContainer, clientX: 40, clientY: 40 })] }))
      currentContainer.dispatchEvent(new TouchEvent('touchmove', { touches: [new Touch({ identifier: 1, target: currentContainer, clientX: 40, clientY: 140 })] }))
    }
    else {
      const scrollbar = document.createElement('div')
      scrollbar.className = 'scrollable-area-scrollbar--vertical'
      currentContainer.parentElement?.appendChild(scrollbar)
      scrollbar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, buttons: 1 }))
    }
    expect(cancelScroll).toHaveBeenCalled()
    currentContainer.scrollTop = 0
    currentContainer.dispatchEvent(new Event('scroll'))
    expect(following.showLatest.value).toBe(true)
    messages.value = [...messages.value, { id: 'assistant-2' }]
    await flushReactivity()
    expect(scrollToIndex).not.toHaveBeenCalled()

    following.scrollToLatest()
    expect(following.showLatest.value).toBe(false)
    expect(scrollToIndex).toHaveBeenCalledWith(3, 'end')
    scrollToIndex.mockClear()
    currentContainer.firstElementChild?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
    messages.value = [...messages.value, { id: 'assistant-3' }]
    await flushReactivity()
    expect(scrollToIndex).toHaveBeenCalledWith(4, 'end')
  })

  it('aIRI-047 keeps a small upward gesture unlocked inside the tail tolerance', async () => {
    const currentContainer = createScrollContainer(3)
    currentContainer.scrollTop = currentContainer.scrollHeight
    const container = shallowRef<HTMLElement | null>(currentContainer)
    const messages = shallowRef<TestMessage[]>([{ id: 'user-1' }, { id: 'assistant-1' }, { id: 'user-2' }])
    const scrollToIndex = vi.fn()
    const following = startScrollBehavior({ container, messages, scrollToIndex })
    await flushReactivity()
    scrollToIndex.mockClear()
    currentContainer.dispatchEvent(new WheelEvent('wheel', { deltaY: -10 }))
    currentContainer.scrollTop -= 10
    currentContainer.dispatchEvent(new Event('scroll'))
    expect(following.showLatest.value).toBe(true)
    messages.value = [...messages.value, { id: 'assistant-2' }]
    await flushReactivity()
    expect(scrollToIndex).not.toHaveBeenCalled()
  })

  it('keeps a streaming tail aligned to the viewport end', async () => {
    const currentContainer = createScrollContainer(1)
    const container = shallowRef<HTMLElement | null>(currentContainer)
    const messages = shallowRef<TestMessage[]>([{ id: 'assistant-1' }])
    const scrollToIndex = vi.fn()
    startScrollBehavior({ container, messages, scrollToIndex })
    await flushReactivity()
    scrollToIndex.mockClear()

    messages.value = [{ id: 'assistant-1' }]
    await flushReactivity()

    expect(scrollToIndex).toHaveBeenCalledTimes(1)
    expect(scrollToIndex).toHaveBeenCalledWith(0, 'end')
  })

  // http://127.0.0.1:5174 — AIRI-046: larger text must follow the tail without pulling a reader out of older history.
  it('aIRI-046 follows reading reflow until the reader scrolls away', async () => {
    const currentContainer = createScrollContainer(3)
    currentContainer.scrollTop = currentContainer.scrollHeight
    const container = shallowRef<HTMLElement | null>(currentContainer)
    const messages = shallowRef<TestMessage[]>([{ id: 'generated-1' }, { id: 'generated-2' }, { id: 'generated-3' }])
    const layout = shallowRef(18)
    const scrollToIndex = vi.fn()
    const following = startScrollBehavior({ container, messages, scrollToIndex, layout })
    await flushReactivity()
    scrollToIndex.mockClear()
    layout.value = 22
    await flushReactivity()
    expect(scrollToIndex).toHaveBeenCalledWith(2, 'end')
    scrollToIndex.mockClear()
    currentContainer.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }))
    currentContainer.scrollTop = 0
    currentContainer.dispatchEvent(new Event('scroll'))
    layout.value = 26
    await flushReactivity()
    expect(scrollToIndex).not.toHaveBeenCalled()
    expect(following.showLatest.value).toBe(true)
    following.scrollToLatest()
    expect(scrollToIndex).toHaveBeenCalledWith(2, 'end')
    expect(following.showLatest.value).toBe(false)
  })
})
