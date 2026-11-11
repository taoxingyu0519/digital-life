import type { ChatHistoryItem } from '../../../types/chat'

import { describe, expect, it } from 'vitest'

import { getChatHistoryItemKey, mergeChatHistory } from './utils'

// http://127.0.0.1:5174 — AIRI-046: live captions and confirmed history share one visible message per ID.
it('aIRI-046 merges captions in first-seen order without duplicating or changing saved records', () => {
  const saved: ChatHistoryItem[] = [
    { id: 'generated-old', role: 'user', content: 'Generated historical record' },
    { id: 'generated-user', role: 'user', content: 'Generated old hypothesis', createdAt: 10 },
    { id: 'generated-next', role: 'user', content: 'Generated next turn', createdAt: 30 },
  ]
  const answer: ChatHistoryItem = { id: 'generated-answer', role: 'assistant', content: 'Generated live answer', createdAt: 20, slices: [], tool_results: [] }
  const merged = mergeChatHistory(saved, [answer, { ...saved[1], content: 'Generated corrected text' }])
  expect(merged.map(message => message.id)).toEqual(['generated-old', 'generated-user', 'generated-answer', 'generated-next'])
  expect(merged[1].content).toBe('Generated corrected text')
  expect(saved[1].content).toBe('Generated old hypothesis')
  expect(mergeChatHistory(merged, [answer])).toHaveLength(4)
})

describe('getChatHistoryItemKey', () => {
  it('prefers stable message ids when available', () => {
    const createdAt = 1700000000000

    const userMessage: ChatHistoryItem = { role: 'user', content: 'hi', createdAt, id: 'user-1' }
    const assistantMessage: ChatHistoryItem = { role: 'assistant', content: 'hello', createdAt, id: 'assistant-1', slices: [], tool_results: [] }

    expect(getChatHistoryItemKey(userMessage, 0)).toBe('user-1')
    expect(getChatHistoryItemKey(assistantMessage, 1)).toBe('assistant-1')
  })

  it('falls back to a role + timestamp + index composite when ids are missing', () => {
    const createdAt = 1700000000000

    const userMessage: ChatHistoryItem = { role: 'user', content: 'hi', createdAt }
    const assistantMessage: ChatHistoryItem = { role: 'assistant', content: 'hello', createdAt, slices: [], tool_results: [] }

    expect(getChatHistoryItemKey(userMessage, 0)).toBe('user:1700000000000:0')
    expect(getChatHistoryItemKey(assistantMessage, 1)).toBe('assistant:1700000000000:1')
  })

  it('falls back to index when message is missing', () => {
    expect(getChatHistoryItemKey(undefined, 0)).toBe(0)
    expect(getChatHistoryItemKey(undefined, 1)).toBe(1)
  })

  it('falls back to a role + index composite when ids and timestamps are missing', () => {
    const userMessage: ChatHistoryItem = { role: 'user', content: 'hi' }
    const assistantMessage: ChatHistoryItem = { role: 'assistant', content: 'hello', slices: [], tool_results: [] }

    expect(getChatHistoryItemKey(userMessage, 0)).toBe('user:0')
    expect(getChatHistoryItemKey(assistantMessage, 1)).toBe('assistant:1')
  })
})
