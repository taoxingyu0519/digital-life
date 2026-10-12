import type { VisionPerson } from '@proj-airi/local-vision/contracts'
import type {} from 'pinia-plugin-synced'

import { useNow } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { useAuthStore } from './auth'

/** Camera identity selects local conversations. It never supplies hosted credentials or developer permissions. */
export const useStageIdentityStore = defineStore('stage-identity', () => {
  const auth = useAuthStore()
  const cameraAccounts = ref(false)
  const lease = ref<(VisionPerson & { validUntil: number }) | null>(null)
  const now = useNow({ interval: 100 })
  const person = computed(() => cameraAccounts.value && lease.value && lease.value.validUntil > now.value.getTime() ? lease.value : null)
  const userId = computed(() => cameraAccounts.value ? person.value ? `local-face:${person.value.person_id}` : 'local' : auth.userId)
  const displayName = computed(() => cameraAccounts.value ? person.value?.display_name : auth.user?.name)
  const cloudSyncAllowed = computed(() => !cameraAccounts.value && auth.userId !== 'local')

  /** The capture leader publishes only confirmed identity and a short lease, at most once per second for the same person. */
  async function setCameraIdentity(value: VisionPerson | null, validUntil = 0) {
    cameraAccounts.value = true
    if (!value) {
      lease.value = null
      return
    }
    if (lease.value?.person_id === value.person_id && lease.value.display_name === value.display_name
      && validUntil - lease.value.validUntil < 1000 && lease.value.validUntil > Date.now()) {
      return
    }
    lease.value = { person_id: value.person_id, display_name: value.display_name, validUntil }
  }

  return { cameraAccounts, lease, person, userId, displayName, cloudSyncAllowed, setCameraIdentity }
}, {
  synced: { state: true, actions: ['setCameraIdentity'] },
})
