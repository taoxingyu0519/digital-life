import type { SharedSettingsCheckpoint, SharedSettingsState } from '../services/shared-settings-client'
import type { SharedSettings, SharedSettingsSnapshot } from '../services/shared-settings-contract'

import en from '@proj-airi/i18n/locales/en'

import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { afterEach, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { createApp, h } from 'vue'
import { createI18n } from 'vue-i18n'

import BrainPromptEditor from '../components/scenarios/brain-prompt-editor.vue'

import { sharedSettingsFixture } from '../../test/shared-settings'
import { SharedSettingsClient } from '../services/shared-settings-client'
import { useAiriCardStore } from './modules/airi-card'
import { useArtistryStore } from './modules/artistry'
import { useBrainPromptsStore } from './modules/brain-prompts'
import { useConsciousnessStore } from './modules/consciousness'
import { useSpeechStore } from './modules/speech'
import { useVisionStore } from './modules/vision'
import { useProviderConfigStore } from './providers/config'
import { useSettingsStageModel } from './settings/stage-model'
import { useSharedSettingsStore } from './shared-settings'

vi.mock('@proj-airi/realtime-voice/client', () => ({ VoiceClient: class {
  async config() { return { configured: false } }
  close() {}
} }))

const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).reverse().forEach(cleanup => cleanup())
  vi.restoreAllMocks()
  localStorage.clear()
})

/** Only host IO is replaced. Each client owns a distinct device configuration and durable checkpoint. */
function hostFixture() {
  let snapshot: SharedSettingsSnapshot = { revision: 0, settings: null }
  let offline = false
  const original = window.fetch.bind(window)
  const network = vi.spyOn(window, 'fetch').mockImplementation(async (url, options) => {
    if (String(url) !== '/api/shared-settings')
      return original(url, options)
    if (offline)
      throw new Error('generated-disconnect')
    if (options?.method === 'PUT') {
      const input = JSON.parse(String(options.body))
      if (input.revision !== snapshot.revision)
        return Response.json(snapshot, { status: 409 })
      snapshot = { revision: snapshot.revision + 1, settings: input.settings }
    }
    return Response.json(snapshot)
  })
  return {
    network,
    get snapshot() { return structuredClone(snapshot) },
    disconnect: () => { offline = true },
    reconnect: () => { offline = false },
  }
}

function device(initial = sharedSettingsFixture(), saved?: SharedSettingsCheckpoint) {
  let settings = structuredClone(initial)
  let checkpoint = saved
  let state: SharedSettingsState = 'loading'
  let conflicting = false
  const backups: SharedSettings[] = []
  const client = new SharedSettingsClient({
    read: () => structuredClone(settings),
    apply: async (value) => { settings = structuredClone(value) },
    meaningful: value => !!value.model.provider || value.prompts.fast !== sharedSettingsFixture().prompts.fast,
    backup: value => backups.push(structuredClone(value)),
    checkpoint: (value) => { checkpoint = structuredClone(value) },
    status: (value, _revision, conflict) => {
      state = value
      conflicting = conflict
    },
  }, saved)
  cleanups.push(() => client.stop())
  return {
    client,
    backups,
    get settings() { return settings },
    get checkpoint() { return checkpoint },
    get state() { return state },
    get conflicting() { return conflicting },
  }
}

// Local report: http://127.0.0.1:5174/#tasks/AIRI-039
// ROOT CAUSE: browser-origin storage kept prompts and model selection isolated. Both clients now use one host revision.
it('aIRI-039 syncs saved prompts and slow models bidirectionally and restores them on a fresh device', async () => {
  const host = hostFixture()
  const desktop = device()
  desktop.settings.prompts.fast += '\n生成的台式机规则。'
  desktop.settings.model.provider = 'public-provider'
  desktop.settings.model.model = 'public-slow-model-a'
  await desktop.client.start()
  const laptop = device()
  await laptop.client.start()
  expect(laptop.settings).toEqual(desktop.settings)
  laptop.settings.prompts.slow += '\n生成的笔记本规则。'
  laptop.settings.model.model = 'public-slow-model-b'
  laptop.client.edited()
  await laptop.client.refresh()
  await desktop.client.refresh()
  expect(desktop.settings.prompts.slow).toBe(laptop.settings.prompts.slow)
  expect(desktop.settings.model.model).toBe('public-slow-model-b')
  const changedOrigin = device()
  await changedOrigin.client.start()
  expect(changedOrigin.settings).toEqual(host.snapshot.settings)
})

it('an unconfigured new origin cannot replace existing host configuration with defaults', async () => {
  const host = hostFixture()
  const desktop = device()
  desktop.settings.prompts.fast += '\n保留此生成规则。'
  await desktop.client.start()
  const origin = device()
  await origin.client.start()
  expect(host.snapshot.revision).toBe(1)
  expect(origin.settings.prompts.fast).toBe(desktop.settings.prompts.fast)
})

it('offline edits survive reload, and a competing update produces a recoverable conflict', async () => {
  hostFixture()
  const first = device()
  first.settings.prompts.fast += '\n生成初始规则。'
  await first.client.start()
  const second = device()
  await second.client.start()
  first.client.stop()
  second.settings.model.model = 'new-host-model'
  second.client.edited()
  await second.client.refresh()
  first.settings.model.model = 'offline-draft'
  const reloaded = device(first.settings, first.checkpoint)
  await reloaded.client.start()
  expect(reloaded.state).toBe('conflict')
  expect(reloaded.settings.model.model).toBe('offline-draft')
  await reloaded.client.useHost()
  expect(reloaded.settings.model.model).toBe('new-host-model')
  expect(reloaded.backups[0].model.model).toBe('offline-draft')
})

it('disconnection retains pending edits until reconnect and saves them without a conflict when the host is unchanged', async () => {
  const host = hostFixture()
  const laptop = device()
  laptop.settings.prompts.fast += '\n生成同步规则。'
  await laptop.client.start()
  host.disconnect()
  laptop.settings.model.model = 'offline-model'
  laptop.client.edited()
  await laptop.client.refresh()
  expect(laptop.state).toBe('offline')
  expect(laptop.checkpoint?.pending).toBe(true)
  laptop.client.stop()
  const reload = device(laptop.settings, laptop.checkpoint)
  await reload.client.start()
  expect(reload.settings.model.model).toBe('offline-model')
  host.reconnect()
  await reload.client.refresh()
  expect(reload.state).toBe('synced')
  expect(host.snapshot.settings?.model.model).toBe('offline-model')
})

it('explicit local conflict resolution uses the latest revision and preserves the selected draft', async () => {
  const host = hostFixture()
  const first = device()
  first.settings.prompts.fast += '\n生成主配置。'
  await first.client.start()
  const second = device()
  await second.client.start()
  first.settings.model.model = 'first-edit'
  first.client.edited()
  await first.client.refresh()
  second.settings.model.model = 'second-edit'
  second.client.edited()
  await second.client.refresh()
  expect(second.state).toBe('conflict')
  await second.client.useLocal()
  expect(host.snapshot.settings?.model.model).toBe('second-edit')
  expect(host.snapshot.revision).toBe(3)
})

it('a disconnected first device cannot seed an existing host with a stale local configuration', async () => {
  const host = hostFixture()
  const desktop = device()
  desktop.settings.prompts.fast += '\n生成台式机规则。'
  await desktop.client.start()
  host.disconnect()
  const laptop = device()
  await laptop.client.start()
  laptop.settings.prompts.fast += '\n生成离线笔记本规则。'
  laptop.client.edited()
  host.reconnect()
  await laptop.client.refresh()
  expect(laptop.state).toBe('conflict')
  expect(host.snapshot.settings?.prompts.fast).toBe(desktop.settings.prompts.fast)
})

async function renderer(namespace: string, leadership: 'leader-only' | 'follower-only', initialize = true, editor = false) {
  const pinia = createPinia()
  const runtime = createSyncedPiniaPlugin({ namespace, leadership })
  pinia.use(runtime.plugin)
  const container = document.createElement('div')
  document.body.append(container)
  let shared!: ReturnType<typeof useSharedSettingsStore>
  const app = createApp({ setup() {
    shared = useSharedSettingsStore()
    useArtistryStore()
    useSpeechStore()
    useVisionStore()
    useSettingsStageModel()
    return () => editor ? h(BrainPromptEditor) : h('div')
  } })
  app.use(pinia).use(createI18n({ legacy: false, locale: 'en', messages: { en } })).mount(container)
  const cards = useAiriCardStore(pinia)
  cleanups.push(() => {
    shared.dispose()
    app.unmount()
    runtime.dispose()
    disposePinia(pinia)
    container.remove()
  })
  await cards.initialize()
  if (initialize)
    await shared.initialize(runtime)
  if (initialize && leadership === 'leader-only')
    await vi.waitFor(() => expect(['synced', 'empty', 'conflict']).toContain(shared.state), { timeout: 5000 })
  return { shared, runtime, cards, container, prompts: useBrainPromptsStore(pinia), model: useConsciousnessStore(pinia), providers: useProviderConfigStore(pinia) }
}

it('the real store applies provider then model, persists both, and keeps microphone and camera choices local', async () => {
  const host = hostFixture()
  const source = device()
  source.settings.providers = [{ id: 'public-provider', definitionId: 'openai-compatible', added: true, config: { baseUrl: 'http://127.0.0.1:9000/v1/', apiKey: 'generated-public-regression-key' } }]
  source.settings.model.provider = 'public-provider'
  source.settings.model.model = 'public-slow-model'
  source.settings.prompts.slow += '\n生成的服务端规则。'
  await source.client.start()
  localStorage.setItem('settings/test/device-marker', 'generated-microphone-selection')
  const target = await renderer(`shared-test-${crypto.randomUUID()}`, 'leader-only')
  expect(target.shared.state).toBe('synced')
  expect(target.model.activeModel).toBe('public-slow-model')
  expect(target.providers.providers['public-provider'].config.apiKey).toBe('generated-public-regression-key')
  expect(target.prompts.config.slow).toBe(source.settings.prompts.slow)
  expect(localStorage.getItem('settings/test/device-marker')).toBe('generated-microphone-selection')
  expect(localStorage.getItem('settings/consciousness/active-model')).toContain('public-slow-model')
  expect(target.cards.currentModels.consciousness.model).toBe('public-slow-model')
  const reloaded = await renderer(`shared-test-${crypto.randomUUID()}`, 'leader-only')
  expect(reloaded.model.activeModel).toBe('public-slow-model')
  expect(host.snapshot.settings).toEqual(source.settings)
  expect(host.snapshot.revision).toBe(1)
  target.model.activeModel = 'public-updated-model'
  await target.cards.updateActiveCardConsciousness({
    provider: target.model.activeProvider,
    model: target.model.activeModel,
  })
  await target.shared.refresh()
  expect(host.snapshot.settings?.model.model).toBe('public-updated-model')
})

it('login defaults cannot reset the shared slow model or upload hosted authentication providers', async () => {
  const host = hostFixture()
  const source = device()
  source.settings.providers = [{ id: 'public-provider', definitionId: 'openai-compatible', added: true, config: { baseUrl: 'http://127.0.0.1:9000/v1/', apiKey: 'generated-public-regression-key' } }]
  source.settings.model.provider = 'public-provider'
  source.settings.model.model = 'public-slow-model'
  await source.client.start()
  const target = await renderer(`shared-test-${crypto.randomUUID()}`, 'leader-only')
  await target.providers.ensureProvider('official-provider', 'official-provider')
  target.model.activeProvider = 'official-provider'
  target.model.activeModel = 'generated-official-model'
  await target.shared.restoreModel()
  await target.shared.refresh()
  expect(target.model.activeModel).toBe('public-slow-model')
  expect(host.snapshot.settings?.providers.map(row => row.definitionId)).not.toContain('official-provider')
  expect(host.snapshot.settings).toEqual(source.settings)
  expect(host.snapshot.revision).toBe(1)
})

it('only the elected window performs host IO; follower conflict actions await the leader', async () => {
  const host = hostFixture()
  const namespace = `shared-test-${crypto.randomUUID()}`
  const leader = await renderer(namespace, 'leader-only')
  const follower = await renderer(namespace, 'follower-only')
  expect(follower.shared.state).toBe('follower')
  const calls = host.network.mock.calls.filter(([url]) => String(url) === '/api/shared-settings').length
  expect(calls).toBe(1)
  const updated = structuredClone(leader.prompts.config)
  updated.fast += '\n生成的多窗口规则。'
  leader.prompts.save(updated)
  await follower.shared.useLocal()
  expect(host.snapshot.settings?.prompts.fast).toBe(updated.fast)
  expect(host.snapshot.revision).toBe(1)
})

it('an edit made during upload is retained and sent in the next revision', async () => {
  const host = hostFixture()
  const laptop = device()
  laptop.settings.prompts.fast += '\n生成的上传基线。'
  await laptop.client.start()
  const implementation = host.network.getMockImplementation()!
  let release!: () => void
  host.network.mockImplementationOnce(async (input, options) => {
    await new Promise<void>((resolveReady) => {
      release = resolveReady
    })
    return implementation(input, options)
  })
  laptop.settings.model.model = 'first-draft'
  laptop.client.edited()
  const pending = laptop.client.refresh()
  laptop.settings.model.model = 'newer-draft'
  laptop.client.edited()
  release()
  await pending
  expect(laptop.settings.model.model).toBe('newer-draft')
  expect(laptop.checkpoint?.pending).toBe(true)
  await laptop.client.refresh()
  expect(host.snapshot.settings?.model.model).toBe('newer-draft')
  expect(laptop.state).toBe('synced')
})

it('a stopped client ignores late host receipts', async () => {
  const host = hostFixture()
  const desktop = device()
  desktop.settings.prompts.fast += '\n生成的远端规则。'
  await desktop.client.start()
  const implementation = host.network.getMockImplementation()!
  let release!: () => void
  host.network.mockImplementationOnce(async (input, options) => {
    await new Promise<void>((resolveReady) => {
      release = resolveReady
    })
    return implementation(input, options)
  })
  const laptop = device()
  const pending = laptop.client.start()
  laptop.client.stop()
  release()
  await pending
  expect(laptop.settings.prompts.fast).toBe(sharedSettingsFixture().prompts.fast)
  expect(laptop.checkpoint).toBeUndefined()
})

// Local report: http://127.0.0.1:5174/#tasks/AIRI-039
// ROOT CAUSE: the prompt editor reloaded its draft on every saved revision, discarding unsaved edits when another device synced.
it('aIRI-039 retains an unsaved prompt draft when another device saves newer rules', async () => {
  hostFixture()
  const desktop = device()
  desktop.settings.prompts.fast += '\n生成的共享初始规则。'
  await desktop.client.start()
  const target = await renderer(`shared-test-${crypto.randomUUID()}`, 'leader-only', true, true)
  const field = target.container.querySelector('textarea')!
  const draft = `${field.value}\n生成的未保存草稿。`
  await userEvent.fill(field, draft)
  desktop.settings.prompts.fast += '\n生成的另一端更新。'
  desktop.client.edited()
  await desktop.client.refresh()
  await target.shared.refresh()
  expect(field.value).toBe(draft)
  expect(target.prompts.config.fast).toBe(desktop.settings.prompts.fast)
  const save = [...target.container.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Save prompts')!
  expect(save.disabled).toBe(true)
  await userEvent.click([...target.container.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Keep draft and continue editing')!)
  expect(save.disabled).toBe(false)
  await userEvent.click(save)
  await target.shared.refresh()
  expect(target.prompts.config.fast).toBe(draft)
  desktop.client.stop()
  const latest = device()
  await latest.client.start()
  expect(latest.settings.prompts.fast).toBe(draft)
})

it('conflict resolution controls remain available when a resolution request disconnects', async () => {
  const host = hostFixture()
  const first = device()
  first.settings.prompts.fast += '\n生成的冲突基线。'
  await first.client.start()
  const second = device()
  await second.client.start()
  first.settings.model.model = 'new-host-model'
  first.client.edited()
  await first.client.refresh()
  second.settings.model.model = 'pending-local-draft'
  second.client.edited()
  await second.client.refresh()
  host.disconnect()
  await second.client.useHost()
  expect(second.state).toBe('offline')
  expect(second.conflicting).toBe(true)
  expect(second.settings.model.model).toBe('pending-local-draft')
  host.reconnect()
  await second.client.useHost()
  expect(second.conflicting).toBe(false)
  expect(second.state).toBe('synced')
  expect(second.settings.model.model).toBe('new-host-model')
})
