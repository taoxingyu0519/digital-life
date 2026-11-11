import type { ArchiveAnnotation, ArchiveMessage, ArchivePage, ArchivePartner, ArchiveQuery } from '../types/chat-archive'
import type { ChatSessionRecord } from '../types/chat-session'

import { chatSessionsRepo } from '../database/repos/chat-sessions.repo'
import { storage } from '../database/storage'
import { extractMessageText } from '../libs/chat-sync/wire-message'

/** Each operation rechecks the captured caller after IO. A changed identity cannot receive old records. */
export interface ArchiveScope {
  userId: string
  characterId: string
  assertCurrent: () => void
}

const annotationKey = (sessionId: string, messageId: string) => `local:chat/annotations/${encodeURIComponent(sessionId)}/${encodeURIComponent(messageId)}`

function compareMessages(a: ArchiveMessage, b: ArchiveMessage) {
  return (a.at ?? a.sessionAt) - (b.at ?? b.sessionAt) || a.sessionId.localeCompare(b.sessionId) || a.position - b.position
}

async function records(scope: ArchiveScope): Promise<ArchiveMessage[]> {
  scope.assertCurrent()
  const keys = await storage.getKeys('local:chat/sessions')
  scope.assertCurrent()
  const messages: ArchiveMessage[] = []
  for (const key of keys) {
    const record = await storage.getItemRaw<ChatSessionRecord>(key)
    scope.assertCurrent()
    if (!record || record.meta.characterId !== scope.characterId)
      continue
    const meta = record.meta
    for (const [position, message] of record.messages.entries()) {
      if (message.role !== 'user' && message.role !== 'assistant')
        continue
      // Auth-owned historical records remain readable. New mixed-stage records use immutable message ownership.
      const owner = message.archive?.personId ? `local-face:${message.archive.personId}` : meta.userId
      if (owner !== scope.userId)
        continue
      const annotation = message.id ? await storage.getItemRaw<ArchiveAnnotation>(annotationKey(meta.sessionId, message.id)) : null
      scope.assertCurrent()
      messages.push({
        sessionId: meta.sessionId,
        messageId: message.id ?? null,
        position,
        role: message.role,
        text: extractMessageText(message),
        at: message.createdAt ?? null,
        sessionAt: meta.createdAt,
        interrupted: message.role === 'assistant' && !!message.interrupted,
        derived: !!message.localVisionDerived,
        attachments: Array.isArray(message.content) ? message.content.filter(part => part.type === 'image_url').length : 0,
        annotation,
      })
    }
  }
  return messages.sort(compareMessages)
}

/** Enumerates local relationships without selecting, loading or replacing the active stage conversation. */
export async function listArchivePartners(scope: ArchiveScope, all = false): Promise<ArchivePartner[]> {
  const groups = new Map<string, ArchivePartner & { sessionIds: Set<string> }>()
  for (const key of await storage.getKeys('local:chat/sessions')) {
    const record = await storage.getItemRaw<ChatSessionRecord>(key)
    scope.assertCurrent()
    if (!record)
      continue
    for (const message of record.messages) {
      if (message.role !== 'user' && message.role !== 'assistant')
        continue
      const userId = message.archive?.personId ? `local-face:${message.archive.personId}` : record.meta.userId
      if (!all && userId !== scope.userId)
        continue
      const characterId = record.meta.characterId
      const id = JSON.stringify([userId, characterId])
      let group = groups.get(id)
      if (!group) {
        const person = message.archive?.personId ? await storage.getItemRaw<{ display_name: string }>(`local:chat/people/${encodeURIComponent(message.archive.personId)}`) : null
        const index = await chatSessionsRepo.getIndex(userId)
        scope.assertCurrent()
        group = { userId, characterId, displayName: person?.display_name ?? message.archive?.displayName ?? index?.displayName ?? '', sessions: 0, updatedAt: 0, preview: '', sessionIds: new Set() }
        groups.set(id, group)
      }
      group.sessionIds.add(record.meta.sessionId)
      const at = message.createdAt ?? record.meta.updatedAt
      if (at >= group.updatedAt) {
        group.updatedAt = at
        group.preview = extractMessageText(message).slice(0, 100)
      }
    }
  }
  return [...groups.values()].map(({ sessionIds, ...group }) => ({ ...group, sessions: sessionIds.size })).sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Searches persisted sessions without changing the active conversation. Missing historic timestamps are never guessed. */
export async function queryArchive(scope: ArchiveScope, query: ArchiveQuery = {}): Promise<ArchivePage> {
  const needle = query.query?.trim().toLocaleLowerCase()
  const all = (await records(scope)).filter(message =>
    (!query.forRecall || (!message.interrupted && !message.derived))
    && (!needle || [message.text, message.annotation?.note, message.annotation?.summary, message.annotation?.tags.join(' ')].some(text => text?.toLocaleLowerCase().includes(needle)))
    && (query.from === undefined || (message.at !== null && message.at >= query.from))
    && (query.to === undefined || (message.at !== null && message.at <= query.to))
    && (!query.starred || message.annotation?.starred),
  )
  let end = all.length
  if (query.cursor) {
    const anchor = all.findIndex(message => JSON.stringify([message.sessionId, message.position]) === query.cursor)
    if (anchor < 0)
      throw new Error('archive-cursor-changed')
    end = anchor
  }
  const limit = Math.min(100, Math.max(1, query.limit ?? 40))
  const start = Math.max(0, end - limit)
  const messages = all.slice(start, end)
  return { messages, total: all.length, nextCursor: start > 0 ? JSON.stringify([messages[0].sessionId, messages[0].position]) : null }
}

/** Returns original neighboring messages. Search snippets and annotations never replace source text. */
export async function readArchiveContext(scope: ArchiveScope, sessionId: string, messageId: string, radius = 4) {
  const all = await records(scope)
  const index = all.findIndex(message => message.sessionId === sessionId && message.messageId === messageId)
  if (index < 0)
    throw new Error('archive-message-unavailable')
  return all.slice(Math.max(0, index - radius), index + radius + 1)
}

/** Writes annotations under a browser lock so concurrent windows cannot overwrite a pending write. */
export async function annotateArchive(scope: ArchiveScope, sessionId: string, messageId: string, annotation: Omit<ArchiveAnnotation, 'updatedAt'>) {
  return navigator.locks.request(`airi:archive:${sessionId}`, async () => {
    await readArchiveContext(scope, sessionId, messageId, 0)
    scope.assertCurrent()
    await storage.setItemRaw(annotationKey(sessionId, messageId), { ...annotation, updatedAt: Date.now() })
    scope.assertCurrent()
  })
}

/** Keeps annotations from surviving a source deletion. The caller owns original-message deletion and runtime cancellation. */
export async function removeArchiveAnnotation(sessionId: string, messageId: string) {
  await storage.removeItem(annotationKey(sessionId, messageId))
}

/** Exports visible original message payloads and shared annotations, without internal prompts or runtime context. */
export async function exportArchive(scope: ArchiveScope) {
  const visible = await records(scope)
  const sources: Array<{ sessionId: string, messages: Array<{ role: string, content: unknown, id?: string, createdAt?: number }> }> = []
  for (const sessionId of new Set(visible.map(message => message.sessionId))) {
    const record = await chatSessionsRepo.getSession(sessionId)
    scope.assertCurrent()
    if (record) {
      const positions = new Set(visible.filter(message => message.sessionId === sessionId).map(message => message.position))
      sources.push({ sessionId, messages: record.messages.filter((_, position) => positions.has(position)).map(message => ({
        role: message.role,
        content: message.content,
        id: message.id,
        createdAt: message.createdAt,
      })) })
    }
  }
  return { format: 'airi-chat-archive:v1', userId: scope.userId, characterId: scope.characterId, sources, messages: visible }
}
