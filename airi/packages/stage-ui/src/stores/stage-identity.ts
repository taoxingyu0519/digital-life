import type { VisionPerson } from '@proj-airi/local-vision/contracts'
import type {} from 'pinia-plugin-synced'

import type { ChatHistoryItem } from '../types/chat'

import { useNow } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { storage } from '../database/storage'
import { useAuthStore } from './auth'

/** Face observations select archive recipients only. Authentication and the stage conversation remain independent. */
export const useStageIdentityStore = defineStore('stage-identity', () => {
  const auth = useAuthStore()
  const lease = ref<(VisionPerson & { validUntil: number }) | null>(null)
  const names = ref<Record<string, string>>({})
  const now = useNow({ interval: 100 })
  const person = computed(() => lease.value && lease.value.validUntil > now.value.getTime() ? lease.value : null)
  const userId = computed(() => auth.userId)
  const displayName = computed(() => auth.user?.name)
  const cloudSyncAllowed = computed(() => auth.userId !== 'local')
  const archiveUserId = computed(() => person.value ? `local-face:${person.value.person_id}` : auth.userId)
  let loadTask: Promise<void> | undefined
  let nameRevision = 0

  /** Captures a plain input-time recipient; a later face or name update cannot retarget this turn. */
  function captureArchive(characterName = 'AIRI'): NonNullable<ChatHistoryItem['archive']> {
    const current = person.value
    return { personId: current?.person_id ?? null, displayName: current?.display_name ?? '', characterName }
  }

  async function loadNames() {
    loadTask ??= (async () => {
      const current = nameRevision
      const records = await Promise.all((await storage.getKeys('local:chat/people')).map(key => storage.getItemRaw<VisionPerson>(key)))
      if (current === nameRevision)
        names.value = { ...Object.fromEntries(records.filter(record => record !== null).map(record => [record.person_id, record.display_name])), ...names.value }
    })()
    await loadTask
  }

  async function forgetPerson(personId: string) {
    nameRevision++
    if (lease.value?.person_id === personId)
      lease.value = null
    delete names.value[personId]
    await storage.removeItem(`local:chat/people/${encodeURIComponent(personId)}`)
  }

  /** The capture leader publishes confirmed identity. Renewal keeps enough lease time for the next one-Hz frame. */
  async function setCameraIdentity(value: VisionPerson | null, validUntil = 0) {
    if (!value) {
      lease.value = null
      return
    }
    // Rechecking one snapshot can shift its wall-clock expiry by a few milliseconds. Publish only new evidence.
    if (lease.value?.person_id === value.person_id && lease.value.display_name === value.display_name
      && (validUntil - lease.value.validUntil < 100
        || (validUntil - lease.value.validUntil < 1000 && lease.value.validUntil > Date.now() + 1200))) {
      return
    }
    lease.value = { person_id: value.person_id, display_name: value.display_name, validUntil }
    if (names.value[value.person_id] !== value.display_name) {
      names.value[value.person_id] = value.display_name
      await storage.setItemRaw(`local:chat/people/${encodeURIComponent(value.person_id)}`, value)
    }
  }

  return { lease, names, person, userId, displayName, cloudSyncAllowed, archiveUserId, setCameraIdentity, loadNames, forgetPerson, captureArchive }
}, {
  synced: { state: true, actions: ['setCameraIdentity', 'loadNames', 'forgetPerson'] },
})
