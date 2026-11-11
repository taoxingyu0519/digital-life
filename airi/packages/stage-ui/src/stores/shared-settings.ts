import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import type { SharedSettingsState } from '../services/shared-settings-client'

import { brainPromptDefaults } from '@proj-airi/realtime-voice/prompts'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import * as v from 'valibot'

import { getDefinedProvider } from '../libs/providers'
import { SharedSettingsClient } from '../services/shared-settings-client'
import { deviceProviderDefinitions, sharedSettingsSchema, sharedSettingsSnapshotSchema } from '../services/shared-settings-contract'
import { useAiriCardStore } from './modules/airi-card'
import { useBrainPromptsStore } from './modules/brain-prompts'
import { useConsciousnessStore } from './modules/consciousness'
import { useConsciousnessSettingsStore } from './modules/consciousness-settings'
import { useRealtimeVoiceStore } from './modules/realtime-voice'
import { useSlowBrainStore } from './modules/slow-brain'
import { useWebSearchStore } from './modules/web-search'
import { useProviderConfigStore } from './providers/config'
import { useProviderStore } from './providers/provider'

const checkpointKey = 'settings/shared-settings/checkpoint'
const backupKey = 'settings/shared-settings/local-backup'
const checkpointSchema = v.object({ ...sharedSettingsSnapshotSchema.entries, pending: v.boolean() })
const backupSchema = v.object({ settings: sharedSettingsSchema, savedAt: v.string() })

function stored<T extends v.GenericSchema>(key: string, schema: T) {
  try {
    const result = v.safeParse(schema, JSON.parse(localStorage.getItem(key) ?? 'null'))
    return result.success ? result.output : undefined
  }
  catch { return undefined }
}

/** Synchronizes agent configuration through the existing host, independently of account login. */
export const useSharedSettingsStore = defineStore('shared-settings', () => {
  const prompts = useBrainPromptsStore()
  const providers = useProviderConfigStore()
  const providerRuntime = useProviderStore()
  const model = useConsciousnessStore()
  const cards = useAiriCardStore()
  const policies = useConsciousnessSettingsStore()
  const conversation = useSlowBrainStore()
  const voice = useRealtimeVoiceStore()
  const search = useWebSearchStore()
  const state = ref<SharedSettingsState>('loading')
  const revision = ref(0)
  const conflicting = ref(false)
  const backupAt = ref(stored(backupKey, backupSchema)?.savedAt ?? '')
  let stopLeadership: (() => void) | undefined
  let client: SharedSettingsClient | undefined

  const modelSnapshot = computed(() => ({
    provider: model.activeProvider,
    model: model.activeModel,
    customModel: model.customModelName,
    temperature: model.temperature,
    topP: model.topP,
    reasoning: policies.reasoning,
    temperatureEnabled: policies.temperatureEnabled,
    topPEnabled: policies.topPEnabled,
  }))
  let lastUserModel = stored(checkpointKey, checkpointSchema)?.settings?.model
  function isUserModel() {
    return getDefinedProvider(providers.providers[model.activeProvider]?.definitionId ?? model.activeProvider)?.configuredBy !== 'authentication'
  }
  watch(() => JSON.stringify(modelSnapshot.value), (value) => {
    if (isUserModel())
      lastUserModel = JSON.parse(value)
  }, { immediate: true, flush: 'sync' })

  const snapshot = computed(() => {
    const userModel = isUserModel()
    return v.parse(sharedSettingsSchema, JSON.parse(JSON.stringify({
      prompts: prompts.config,
      providers: Object.values(providers.providers)
        .filter(row => row.configuredBy !== 'authentication' && !deviceProviderDefinitions.has(row.definitionId) && (providers.addedProviders[row.id] || row.id === model.activeProvider))
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(row => ({ id: row.id, definitionId: row.definitionId, config: row.config, added: !!providers.addedProviders[row.id] })),
      model: userModel ? modelSnapshot.value : lastUserModel ?? { ...modelSnapshot.value, provider: '', model: '', customModel: '' },
      conversation: { style: conversation.conversationStyle, delay: conversation.continuationDelaySeconds, textInput: voice.useForText },
      search: { enabled: search.enabled, provider: search.provider, apiKey: search.apiKey, firecrawlApiKey: search.firecrawlApiKey },
    })))
  })
  const signature = computed(() => JSON.stringify(snapshot.value))
  watch(signature, () => client?.edited(), { flush: 'sync' })

  function backup(settings: v.InferOutput<typeof sharedSettingsSchema>) {
    const savedAt = new Date().toISOString()
    localStorage.setItem(backupKey, JSON.stringify({ settings, savedAt }))
    backupAt.value = savedAt
  }

  async function apply(settings: v.InferOutput<typeof sharedSettingsSchema>) {
    voice.stop()
    await providers.applySharedProviders(settings.providers)
    // Hosted account defaults remain governed by login, rather than another device's authentication.
    if (settings.model.provider || isUserModel()) {
      await model.applySharedModel(settings.model)
      await cards.updateActiveCardConsciousness({ provider: settings.model.provider, model: settings.model.model })
    }
    prompts.save(settings.prompts)
    conversation.conversationStyle = settings.conversation.style
    conversation.continuationDelaySeconds = settings.conversation.delay
    voice.useForText = settings.conversation.textInput
    search.enabled = settings.search.enabled
    search.provider = settings.search.provider
    search.apiKey = settings.search.apiKey
    search.firecrawlApiKey = settings.search.firecrawlApiKey
    void providerRuntime.refreshListedProviderValidation().catch(() => {})
  }

  async function initialize(runtime: SyncedPiniaRuntime) {
    if (stopLeadership)
      return
    function createClient() {
      const checkpoint = stored(checkpointKey, checkpointSchema)
      return new SharedSettingsClient({
        read: () => snapshot.value,
        apply,
        meaningful: value => !!value.model.provider || !!value.search.enabled || !!value.search.apiKey || !!value.search.firecrawlApiKey
          || value.providers.some(row => row.added && Object.values(row.config).some(field => typeof field === 'string' && field.length > 0))
          || JSON.stringify(value.prompts) !== JSON.stringify(brainPromptDefaults),
        backup,
        checkpoint: value => localStorage.setItem(checkpointKey, JSON.stringify({ revision: value.revision, settings: value.baseline, pending: value.pending })),
        status: (value, version, conflict) => {
          state.value = value
          revision.value = version
          conflicting.value = conflict
        },
      }, checkpoint ? { revision: checkpoint.revision, baseline: checkpoint.settings, pending: checkpoint.pending } : undefined)
    }
    let previousLeadership: boolean | undefined
    async function changeLeadership(leader: boolean) {
      if (leader === previousLeadership)
        return
      previousLeadership = leader
      client?.stop()
      if (leader) {
        // A promoted window reads the previous owner's durable revision instead of publishing its stale checkpoint.
        client = createClient()
        await client.start()
      }
      else {
        state.value = 'follower'
      }
    }
    stopLeadership = runtime.onLeadershipChange((leader) => {
      void changeLeadership(leader)
    })
    await changeLeadership(runtime.isLeader())
  }

  function dispose() {
    stopLeadership?.()
    stopLeadership = undefined
    client?.stop()
    client = undefined
  }

  async function refresh() {
    await client?.refresh()
  }
  async function useHost() {
    await client?.useHost()
  }
  async function useLocal() {
    await client?.useLocal()
  }
  /** Login defaults must not replace a slow model already selected in shared agent settings. */
  async function restoreModel() {
    const selection = lastUserModel?.provider ? lastUserModel : stored(checkpointKey, checkpointSchema)?.settings?.model
    if (!selection?.provider)
      return
    await model.applySharedModel(selection)
    await cards.updateActiveCardConsciousness({ provider: selection.provider, model: selection.model })
  }
  async function restoreBackup() {
    const previous = stored(backupKey, backupSchema)
    if (!previous)
      return
    const current = snapshot.value
    await apply(previous.settings)
    backup(current)
    client?.edited()
    await client?.useLocal()
  }

  return { state, revision, conflicting, backupAt, initialize, dispose, refresh, useHost, useLocal, restoreBackup, restoreModel }
}, { synced: { state: false, actions: ['refresh', 'useHost', 'useLocal', 'restoreBackup', 'restoreModel'] } })
