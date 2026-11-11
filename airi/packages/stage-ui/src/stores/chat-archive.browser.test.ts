import type { ChatHistoryItem } from '../types/chat'

import en from '@proj-airi/i18n/locales/en'
import zh from '@proj-airi/i18n/locales/zh-Hans'

import { createPinia, disposePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createApp, h } from 'vue'
import { createI18n } from 'vue-i18n'

import ChatArchive from '../components/scenarios/chat-archive.vue'

import { chatSessionsRepo } from '../database/repos/chat-sessions.repo'
import { storage } from '../database/storage'
import { queryArchive } from '../services/chat-archive'
import { useChatArchiveStore } from './chat-archive'
import { useChatSessionStore } from './chat/session-store'
import { useAiriCardStore } from './modules/airi-card'
import { useStageIdentityStore } from './stage-identity'

import '@proj-airi/ui/main.css'
import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup())
  vi.restoreAllMocks()
  localStorage.clear()
})

async function fixture() {
  localStorage.clear()
  await storage.clear()
  const pinia = createPinia()
  const i18n = createI18n({ legacy: false, locale: 'zh-Hans', fallbackLocale: 'en', messages: { en, 'zh-Hans': zh } })
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp({ setup: () => {
    useChatArchiveStore()
    return () => h('div')
  } })
  app.use(pinia).use(i18n).mount(container)
  const identity = useStageIdentityStore(pinia)
  const person = { person_id: 'generated-archive-person', display_name: '档案测试人物' }
  await identity.setCameraIdentity(person, Date.now() + 2000)
  const renewal = setInterval(() => {
    void identity.setCameraIdentity(person, Date.now() + 2000)
  }, 500)
  const sessions = useChatSessionStore(pinia)
  await sessions.initialize()
  const characterId = useAiriCardStore(pinia).activeCardId || 'default'
  const archive = useChatArchiveStore(pinia)
  cleanups.push(() => {
    clearInterval(renewal)
    app.unmount()
    disposePinia(pinia)
    container.remove()
  })
  function message(id: string, text: string, at?: number): ChatHistoryItem {
    return { id, role: 'user', content: text, archive: { personId: person.person_id, displayName: person.display_name, characterName: 'AIRI' }, ...(at !== undefined ? { createdAt: at } : {}) }
  }
  const first = await sessions.createSession(characterId, { setActive: false, messages: Array.from({ length: 45 }, (_, index) => message(`earlier-${index}`, `早期交流 ${index}`, 1760000000000 + index * 1000)) })
  const second = await sessions.createSession(characterId, { setActive: false, messages: [message('source-message', '转头后识别丢失，白天光线过亮。', 1760086400000), message('newer-message', '下一次用柔和照明再试。', 1760086401000), message('old-time', '早期导入，没有具体时间。')] })
  const otherCharacter = await sessions.createSession('generated-other-character', { setActive: false, messages: [message('private-character', '另一个智能体的记录')] })
  return { pinia, i18n, identity, sessions, archive, characterId, first, second, otherCharacter, message, renewal }
}

it('aIRI-035 paginates persisted cross-session originals, dates and annotations without changing the active session', async () => {
  const { identity, sessions, archive, characterId, first, second } = await fixture()
  const active = sessions.activeSessionId
  const latest = await archive.query(identity.archiveUserId, characterId, { limit: 10 })
  expect(latest.total).toBe(48)
  expect(latest.messages).toHaveLength(10)
  expect(latest.messages.some(message => message.sessionId === first)).toBe(true)
  expect(latest.messages.some(message => message.sessionId === second)).toBe(true)
  const older = await archive.query(identity.archiveUserId, characterId, { limit: 10, cursor: latest.nextCursor! })
  expect(older.messages.some(message => latest.messages.some(item => item.messageId === message.messageId))).toBe(false)
  await archive.annotate(identity.archiveUserId, characterId, second, 'source-message', { starred: true, tags: ['识别'], note: '下次核对摄像头方向', summary: '光照和转头导致失认，尚未确认原因。' })
  const search = await archive.query(identity.archiveUserId, characterId, { query: '摄像头方向', starred: true })
  expect(search.messages.map(message => message.messageId)).toEqual(['source-message'])
  const day = await archive.query(identity.archiveUserId, characterId, { from: 1760086400000, to: 1760086410000 })
  expect(day.messages).toHaveLength(2)
  expect((await archive.query(identity.archiveUserId, characterId, { query: '具体时间' })).messages[0].at).toBeNull()
  expect(sessions.activeSessionId).toBe(active)
  const exported = await archive.exportRecords(identity.archiveUserId, characterId)
  expect(exported.messages.some(message => message.text === '转头后识别丢失，白天光线过亮。')).toBe(true)
  expect(exported.messages.some(message => message.text.includes('另一个智能体'))).toBe(false)
})

it('aIRI-035 tools work with the archive page closed, preserve source text and reject a changed person', async () => {
  const { identity, archive, sessions, characterId, second, renewal } = await fixture()
  const tools = await archive.createTools()
  const search = tools.find(tool => tool.function.name === 'search_chat_archive')!
  const annotate = tools.find(tool => tool.function.name === 'annotate_chat_archive')!
  const read = tools.find(tool => tool.function.name === 'read_chat_archive')!
  const results = await search.execute({ query: '转头', from: null, to: null, limit: 10 }, { toolCallId: 'search', messages: [] })
  expect(String(results)).toContain('source-message')
  await annotate.execute({ session_id: second, message_id: 'source-message', starred: true, tags: ['光照'], note: '后续复查', summary: '曾讨论转头和光照。' }, { toolCallId: 'annotation', messages: [] })
  expect((await archive.query(identity.archiveUserId, characterId, { starred: true })).messages[0].annotation?.author).toBe('agent')
  expect(String(await read.execute({ session_id: second, message_id: 'source-message' }, { toolCallId: 'read', messages: [] }))).toContain('下一次用柔和照明')
  expect(await archive.recall()).toContain('曾讨论转头和光照')
  expect((await chatSessionsRepo.getSession(second))?.messages.find(message => message.id === 'source-message')?.content).toBe('转头后识别丢失，白天光线过亮。')
  expect(tools.some(tool => tool.function.name.includes('delete'))).toBe(false)
  clearInterval(renewal)
  await identity.setCameraIdentity(null)
  await expect(search.execute({ query: '', from: null, to: null, limit: 10 }, { toolCallId: 'stale', messages: [] })).rejects.toThrow('archive-scope-changed')
  await sessions.ensureCurrentSession()
})

it('aIRI-035 rejects unauthorized other-person reads and late replies, and cascades source deletion', async () => {
  const { identity, archive, sessions, characterId, second, renewal } = await fixture()
  const permission = vi.spyOn(window, 'fetch').mockResolvedValue(Response.json({ authenticated: false, expires_at: 0 }))
  await expect(archive.query('local-face:another-generated-person', characterId)).rejects.toThrow('archive-scope-changed')
  expect(permission.mock.calls[0][0]).toBe('/api/local-vision/developer/session')
  await archive.annotate(identity.archiveUserId, characterId, second, 'source-message', { starred: true, note: '将被清理', tags: [], summary: '将被清理的摘要' })
  await archive.remove(identity.archiveUserId, characterId, second, 'source-message')
  expect((await archive.query(identity.archiveUserId, characterId, { query: '转头' })).total).toBe(0)
  expect(await archive.recall()).not.toContain('将被清理')
  expect(await storage.getKeys(`local:chat/annotations/${encodeURIComponent(second)}`)).toHaveLength(0)
  const delayed = queryArchive({ userId: identity.archiveUserId, characterId, assertCurrent: () => {
    if (identity.archiveUserId === 'local')
      throw new Error('changed-person')
  } })
  clearInterval(renewal)
  await identity.setCameraIdentity(null)
  await expect(delayed).rejects.toThrow('changed-person')
  await sessions.ensureCurrentSession()
  expect(sessions.messages.some(message => message.id === 'source-message')).toBe(false)
})

it('aIRI-035 renders Chinese bubbles, finds original context and persists user edits after remount', async () => {
  const { pinia, i18n, archive, identity, characterId, second } = await fixture()
  const screen = render(ChatArchive, { global: { plugins: [pinia, i18n] } })
  await page.viewport(1100, 850)
  await expect.element(screen.getByRole('textbox', { name: '搜索聊天记录', exact: true })).toBeVisible()
  await screen.getByRole('textbox', { name: '搜索聊天记录', exact: true }).fill('转头')
  await screen.getByRole('button', { name: '查找', exact: true }).click()
  await vi.waitFor(() => expect(document.querySelectorAll('[data-message-id]')).toHaveLength(1))
  await page.screenshot({ path: '__screenshots__/archive-desktop.png' })
  await expect.element(screen.getByText('转头后识别丢失，白天光线过亮。', { exact: true })).toBeVisible()
  await screen.getByRole('button', { name: '查看原文上下文与消息操作', exact: true }).click()
  await screen.getByRole('textbox', { name: '备注', exact: true }).fill('页面保存的备注')
  await screen.getByRole('textbox', { name: '摘要', exact: true }).fill('页面整理的摘要')
  await screen.getByRole('button', { name: '保存整理', exact: true }).click()
  await vi.waitFor(async () => expect((await archive.query(identity.archiveUserId, characterId, { query: '页面保存' })).messages[0]?.annotation?.summary).toBe('页面整理的摘要'))
  screen.unmount()
  const reopened = render(ChatArchive, { global: { plugins: [pinia, i18n] } })
  await expect.element(reopened.getByText('备注：页面保存的备注', { exact: true })).toBeVisible()
  await page.viewport(390, 844)
  document.documentElement.classList.add('dark')
  // Capture the settled product theme, after the shared inputs finish their color transition.
  await vi.waitFor(() => expect(getComputedStyle(document.querySelector('input')!).backgroundColor).toBe('rgb(10, 10, 10)'))
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
  await page.screenshot({ path: '__screenshots__/archive-mobile-dark.png' })
  document.documentElement.classList.remove('dark')
  expect((await chatSessionsRepo.getSession(second))?.messages.find(message => message.id === 'source-message')?.content).toBe('转头后识别丢失，白天光线过亮。')
  reopened.unmount()
})
