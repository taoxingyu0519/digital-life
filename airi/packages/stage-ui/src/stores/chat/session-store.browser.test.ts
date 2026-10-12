import type { User } from 'better-auth'
import type { LeadershipMode, SyncedPiniaRuntime } from 'pinia-plugin-synced'

import type { ChatSessionMeta } from '../../types/chat-session'

import en from '@proj-airi/i18n/locales/en'

import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'

import { storage } from '../../database/storage'
import { useAuthStore } from '../auth'
import { useAiriCardStore } from '../modules/airi-card'
import { useStageIdentityStore } from '../stage-identity'
import { useChatSessionStore } from './session-store'

const generatedUser: User = { id: 'cloud-user', name: 'Test user', email: 'test@example.invalid', emailVerified: false, createdAt: new Date(0), updatedAt: new Date(0) }

vi.mock('../../database/repos/chat-sessions.repo', () => ({
  chatSessionsRepo: {
    addTombstone: vi.fn().mockResolvedValue(undefined),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    dequeueOutbox: vi.fn().mockResolvedValue(undefined),
    dropOutboxForSession: vi.fn().mockResolvedValue(undefined),
    enqueueOutbox: vi.fn().mockResolvedValue(undefined),
    getIndex: vi.fn().mockResolvedValue(null),
    getOutbox: vi.fn().mockResolvedValue([]),
    getSession: vi.fn().mockResolvedValue(null),
    getTombstones: vi.fn().mockResolvedValue([]),
    removeTombstones: vi.fn().mockResolvedValue(undefined),
    saveIndex: vi.fn().mockResolvedValue(undefined),
    saveSession: vi.fn().mockResolvedValue(undefined),
    updateOutboxEntries: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../../libs/product-signals', () => ({
  captureAnalyticsEvent: vi.fn(),
}))

async function connections(): Promise<{ opened: number, active: number }> {
  const response = await fetch('/api/test-chat/connections')
  return response.json()
}

const syncedContexts: Array<{
  pinia: ReturnType<typeof createPinia>
  runtime: SyncedPiniaRuntime
  unmount: () => void
}> = []

function createSyncedContext(namespace: string, leadership: LeadershipMode) {
  const pinia = createPinia()
  const runtime = createSyncedPiniaPlugin({
    callTimeout: 1000,
    leadership,
    namespace,
  })
  pinia.use(runtime.plugin)
  const app = createApp({
    setup() {
      useAiriCardStore()
      return () => null
    },
  })
  const container = document.createElement('div')
  document.body.append(container)
  app.use(pinia).use(createI18n({ legacy: false, locale: 'en', messages: { en } })).mount(container)
  syncedContexts.push({
    pinia,
    runtime,
    unmount: () => {
      app.unmount()
      container.remove()
    },
  })
  return { pinia, runtime }
}

beforeEach(async () => {
  localStorage.clear()
  await storage.clear()
  const request = window.fetch.bind(window)
  vi.spyOn(window, 'fetch').mockImplementation((url, options) => {
    if (url === '/api/test-chat/connections')
      return request(url, options)
    return Promise.resolve(new Response(null, { status: 503 }))
  })
})

afterEach(() => {
  for (const context of syncedContexts.splice(0)) {
    context.runtime.dispose()
    context.unmount()
    disposePinia(context.pinia)
  }
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('chat session synchronization', () => {
  it('aIRI-034 converges on a face account across renderers without resetting matching sessions or opening cloud sockets', async () => {
    const namespace = `face-session:${crypto.randomUUID()}`
    const leader = createSyncedContext(namespace, 'leader-only')
    await vi.waitFor(() => expect(leader.runtime.isLeader()).toBe(true))
    const leaderIdentity = useStageIdentityStore(leader.pinia)
    const leaderSessions = useChatSessionStore(leader.pinia)
    const follower = createSyncedContext(namespace, 'follower-only')
    await vi.waitFor(() => expect(follower.runtime.getLeaderId()).toBe(leader.runtime.participantId))
    const followerIdentity = useStageIdentityStore(follower.pinia)
    const followerSessions = useChatSessionStore(follower.pinia)
    await leaderIdentity.setCameraIdentity({ person_id: 'generated-face', display_name: 'Test person' }, Date.now() + 2000)
    await vi.waitFor(() => expect(followerIdentity.userId).toBe('local-face:generated-face'))
    await followerSessions.initialize()
    const sessionId = followerSessions.activeSessionId
    expect(followerSessions.sessionMetas[sessionId]?.userId).toBe('local-face:generated-face')
    let mutations = 0
    leaderSessions.$subscribe(() => mutations++)
    await followerSessions.activateCurrentUser()
    await followerSessions.activateCurrentUser()
    expect(followerSessions.activeSessionId).toBe(sessionId)
    expect(mutations).toBe(0)
    expect((await connections()).active).toBe(0)
    await leaderIdentity.setCameraIdentity(null)
    await vi.waitFor(() => expect(followerIdentity.userId).toBe('local'))
    await vi.waitFor(() => expect(followerSessions.sessionMetas[followerSessions.activeSessionId]?.userId).toBe('local'))
    expect(followerSessions.messages).not.toEqual(leaderSessions.sessionMessages[sessionId])
  })
  it('initializes a follower through the canonical session action', async () => {
    // ROOT CAUSE:
    //
    // Chat initialization used the local leadership value before the Web Lock
    // election finished. A renderer that started as a follower skipped both
    // session loading and session creation. A later leadership update only
    // started cloud sync, so anonymous chat kept an empty session id.
    //
    // Initialization now calls a synchronized action. The plugin routes the
    // stateful work to the leader and returns the canonical session id. Each
    // window stores that id as its local selection.
    const namespace = `chat-session:${crypto.randomUUID()}`
    const leaderContext = createSyncedContext(namespace, 'leader-only')
    await vi.waitFor(() => expect(leaderContext.runtime.isLeader()).toBe(true))

    setActivePinia(leaderContext.pinia)
    const leaderChatStore = useChatSessionStore()

    const followerContext = createSyncedContext(namespace, 'follower-only')
    setActivePinia(followerContext.pinia)
    const followerChatStore = useChatSessionStore()
    await vi.waitFor(() => expect(followerContext.runtime.getLeaderId()).toBe(leaderContext.runtime.participantId))

    await followerChatStore.initialize()

    expect(followerChatStore.activeSessionId).not.toBe('')
    expect(followerChatStore.activeSessionId).toBe(leaderChatStore.index?.characters.default?.activeSessionId)
    expect(followerChatStore.sessionMetas[followerChatStore.activeSessionId]).toBeDefined()
    expect(Object.keys(leaderChatStore.index?.characters.default?.sessions ?? {})).toHaveLength(1)
  })

  // https://github.com/moeru-ai/airi/issues/2595
  it('keeps a new conversation selected after its first synchronized message for Issue #2595', async () => {
    // ROOT CAUSE:
    //
    // The leader creates the session while the caller selects it locally.
    // The first message then synchronizes a new index ref. An index watcher
    // treated that data update as navigation and restored the old session.
    // Shared index updates no longer control window-local navigation.
    const namespace = `chat-session:${crypto.randomUUID()}`
    const leaderContext = createSyncedContext(namespace, 'leader-only')
    await vi.waitFor(() => expect(leaderContext.runtime.isLeader()).toBe(true))

    setActivePinia(leaderContext.pinia)
    const leaderChatStore = useChatSessionStore()
    await leaderChatStore.initialize()
    const previousSessionId = leaderChatStore.activeSessionId

    const followerContext = createSyncedContext(namespace, 'follower-only')
    setActivePinia(followerContext.pinia)
    const followerChatStore = useChatSessionStore()
    await vi.waitFor(() => expect(followerContext.runtime.getLeaderId()).toBe(leaderContext.runtime.participantId))
    await followerChatStore.initialize()

    const newSessionId = await followerChatStore.createSession('default', { setActive: false })
    await followerChatStore.setActiveSession(newSessionId)
    followerChatStore.appendSessionMessage(newSessionId, {
      id: 'first-user-message',
      role: 'user',
      content: 'Hello',
    })

    await vi.waitFor(() => expect(leaderChatStore.sessionMessages[newSessionId]).toHaveLength(2))
    await vi.waitFor(() => expect(followerChatStore.sessionMessages[newSessionId]).toHaveLength(2))

    expect(previousSessionId).not.toBe(newSessionId)
    expect(followerChatStore.activeSessionId).toBe(newSessionId)
  })

  it('keeps the leader chat snapshot when new followers receive the auth identity', async () => {
    // ROOT CAUSE:
    //
    // A new settings renderer received the synchronized auth identity after
    // its chat-session store was created. Its local userId watcher cleared the
    // synchronized chat state and proposed that empty snapshot to the leader.
    //
    // The follower routes its observed auth transition to the synchronized
    // identity action. The leader keeps its matching snapshot unchanged.
    const namespace = `chat-session:${crypto.randomUUID()}`
    const leaderContext = createSyncedContext(namespace, 'leader-only')
    await vi.waitFor(() => expect(leaderContext.runtime.isLeader()).toBe(true))

    setActivePinia(leaderContext.pinia)
    const leaderAuthStore = useAuthStore()
    leaderAuthStore.user = { ...generatedUser }
    const leaderChatStore = useChatSessionStore()

    const session: ChatSessionMeta = {
      sessionId: 'session-a',
      userId: 'cloud-user',
      characterId: 'default',
      createdAt: 1,
      updatedAt: 1,
    }
    leaderChatStore.$patch({
      index: {
        userId: 'cloud-user',
        characters: {
          default: {
            activeSessionId: 'session-a',
            sessions: { 'session-a': session },
          },
        },
      },
      sessionMessages: {
        'session-a': [{ id: 'message-a', role: 'user', content: 'Keep this message' }],
      },
      sessionMetas: { 'session-a': session },
    })

    let leaderIdentityActions = 0
    let leaderMutations = 0
    leaderChatStore.$onAction(({ name }) => {
      if (name === 'activateCurrentUser')
        leaderIdentityActions++
    })
    leaderChatStore.$subscribe(() => leaderMutations++)

    const followerContext = createSyncedContext(namespace, 'follower-only')
    setActivePinia(followerContext.pinia)
    const followerChatStore = useChatSessionStore()
    const followerAuthStore = useAuthStore()
    await vi.waitFor(() => expect(followerContext.runtime.getLeaderId()).toBe(leaderContext.runtime.participantId))
    await vi.waitFor(() => expect(followerAuthStore.userId).toBe('cloud-user'))
    await vi.waitFor(() => expect(followerChatStore.sessionMessages['session-a']).toHaveLength(1))

    const secondFollowerContext = createSyncedContext(namespace, 'follower-only')
    setActivePinia(secondFollowerContext.pinia)
    const secondFollowerChatStore = useChatSessionStore()
    const secondFollowerAuthStore = useAuthStore()
    await vi.waitFor(() => expect(secondFollowerContext.runtime.getLeaderId()).toBe(leaderContext.runtime.participantId))
    await vi.waitFor(() => expect(secondFollowerAuthStore.userId).toBe('cloud-user'))
    await vi.waitFor(() => expect(secondFollowerChatStore.sessionMessages['session-a']).toHaveLength(1))
    await Promise.resolve()

    expect(leaderChatStore.sessionMessages['session-a']?.[0]?.id).toBe('message-a')
    expect(followerChatStore.sessionMessages['session-a']?.[0]?.id).toBe('message-a')
    expect(leaderChatStore.index?.userId).toBe('cloud-user')
    expect(followerChatStore.index?.userId).toBe('cloud-user')
    expect(secondFollowerChatStore.sessionMessages['session-a']?.[0]?.id).toBe('message-a')
    expect(leaderIdentityActions).toBe(2)
    expect(leaderMutations).toBe(0)
  })

  // https://github.com/moeru-ai/airi/pull/2394#discussion_r3883360315
  it('keeps synchronized state unchanged when a follower disposes local consumers', async () => {
    // ROOT CAUSE:
    //
    // Follower disposal used the cloud teardown path, which changed the
    // synchronized cloudSyncReady ref. The synchronization plugin then sent
    // the follower's full, potentially stale snapshot to the leader.
    //
    // Follower disposal now destroys only its window-local cloud runtime.
    // Leader-owned actions remain responsible for synchronized state changes.
    const namespace = `chat-session:${crypto.randomUUID()}`
    const leaderContext = createSyncedContext(namespace, 'leader-only')
    await vi.waitFor(() => expect(leaderContext.runtime.isLeader()).toBe(true))

    setActivePinia(leaderContext.pinia)
    const leaderChatStore = useChatSessionStore()
    leaderChatStore.$patch({ cloudSyncReady: true })

    const followerContext = createSyncedContext(namespace, 'follower-only')
    setActivePinia(followerContext.pinia)
    const followerChatStore = useChatSessionStore()
    await vi.waitFor(() => expect(followerContext.runtime.getLeaderId()).toBe(leaderContext.runtime.participantId))
    await vi.waitFor(() => expect(followerChatStore.cloudSyncReady).toBe(true))

    let leaderMutations = 0
    leaderChatStore.$subscribe(() => leaderMutations++)

    followerChatStore.dispose()
    await Promise.resolve()

    expect(followerChatStore.cloudSyncReady).toBe(true)
    expect(leaderChatStore.cloudSyncReady).toBe(true)
    expect(leaderMutations).toBe(0)
  })

  // https://github.com/moeru-ai/airi/pull/2394#discussion_r3883162024
  it('starts a new cloud consumer after leader failover', async () => {
    // ROOT CAUSE:
    //
    // The cloud WebSocket belongs to the elected renderer. If that renderer
    // closed, the next leader received the synchronized state but no action
    // restarted its local WebSocket.
    //
    // The chat lifecycle now observes leader promotion and calls the routed
    // session action. The new leader then starts its local cloud consumer.
    const namespace = `chat-session:${crypto.randomUUID()}`
    const before = await connections()
    const leaderContext = createSyncedContext(namespace, 'follower-preferred')
    await vi.waitFor(() => expect(leaderContext.runtime.isLeader()).toBe(true))

    setActivePinia(leaderContext.pinia)
    const leaderAuthStore = useAuthStore()
    leaderAuthStore.user = { ...generatedUser }
    leaderAuthStore.token = 'cloud-token'
    const leaderChatStore = useChatSessionStore()
    await leaderChatStore.initialize()
    await vi.waitFor(async () => expect((await connections()).opened).toBeGreaterThan(before.opened))
    await vi.waitFor(async () => expect((await connections()).active).toBe(1))
    const leaderConnections = await connections()

    const followerContext = createSyncedContext(namespace, 'follower-preferred')
    setActivePinia(followerContext.pinia)
    const followerAuthStore = useAuthStore()
    const followerChatStore = useChatSessionStore()
    await vi.waitFor(() => expect(followerContext.runtime.getLeaderId()).toBe(leaderContext.runtime.participantId))
    await vi.waitFor(() => expect(followerAuthStore.userId).toBe('cloud-user'))
    await followerChatStore.initialize()

    const stopLeadershipListener = followerContext.runtime.onLeadershipChange((isLeader) => {
      if (isLeader)
        void followerChatStore.ensureCurrentSession()
      else
        followerChatStore.dispose()
    })

    leaderChatStore.dispose()
    leaderContext.runtime.dispose()
    disposePinia(leaderContext.pinia)

    await vi.waitFor(() => expect(followerContext.runtime.isLeader()).toBe(true))
    await vi.waitFor(async () => expect((await connections()).opened).toBeGreaterThan(leaderConnections.opened))
    await vi.waitFor(async () => expect((await connections()).active).toBe(1))
    stopLeadershipListener()
  })
})
