import type { ChatHistoryItem } from '../../../types/chat'

/** Live captions replace their stored counterpart by ID. New captions retain first-seen order while playback finishes. */
export function mergeChatHistory(messages: ChatHistoryItem[], previews: ChatHistoryItem[]): ChatHistoryItem[] {
  if (!previews.length)
    return messages
  const merged = [...messages]
  for (const preview of previews) {
    const existing = merged.findIndex(message => !!preview.id && message.id === preview.id)
    if (existing >= 0) {
      merged[existing] = preview
      continue
    }
    const next = merged.findIndex(message => message.createdAt !== undefined && preview.createdAt !== undefined && message.createdAt > preview.createdAt)
    if (next >= 0)
      merged.splice(next, 0, preview)
    else
      merged.push(preview)
  }
  return merged
}

function isTextPart(part: unknown): part is { type: 'text', text?: string } {
  return typeof part === 'object'
    && part !== null
    && 'type' in part
    && part.type === 'text'
    && 'text' in part
}

function getTextFromContentParts(parts: unknown[]): string {
  return parts.reduce<string[]>((texts, part) => {
    if (!isTextPart(part))
      return texts

    const text = part.text?.trim()
    if (text)
      texts.push(text)

    return texts
  }, []).join('\n\n')
}

export function getChatHistoryItemCopyText(message: ChatHistoryItem): string {
  if (message.role === 'error')
    return message.content

  if (message.role === 'assistant') {
    if (message.slices?.length) {
      const text = message.slices
        .filter(slice => slice.type === 'text')
        .map(slice => slice.text.trim())
        .filter(Boolean)
        .join('\n\n')

      if (text)
        return text
    }

    if (typeof message.content === 'string')
      return message.content

    if (Array.isArray(message.content)) {
      return getTextFromContentParts(message.content)
    }

    return ''
  }

  if (typeof message.content === 'string')
    return message.content

  if (Array.isArray(message.content)) {
    return getTextFromContentParts(message.content)
  }

  return ''
}

export function getChatHistoryItemKey(message: ChatHistoryItem | undefined, index: number): string | number {
  if (!message)
    return index

  if (message.id)
    return message.id

  if (message.createdAt != null)
    return `${message.role}:${message.createdAt}:${index}`

  return `${message.role}:${index}`
}
