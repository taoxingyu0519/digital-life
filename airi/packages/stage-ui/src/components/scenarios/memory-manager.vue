<script setup lang="ts">
import type { InferOutput } from 'valibot'

import { Button, FieldInput, FieldSelect, Textarea } from '@proj-airi/ui'
import { array, number, object, parse, record, string } from 'valibot'
import { onMounted, onScopeDispose, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { extractMessageText } from '../../libs/chat-sync/wire-message'
import { useChatSessionStore } from '../../stores/chat/session-store'
import { useDeveloperAccessStore } from '../../stores/developer-access'
import { useLocalVisionStore } from '../../stores/local-vision'
import { useAiriCardStore } from '../../stores/modules/airi-card'

defineProps<{ mode: 'memory' | 'database' | 'short-term' }>()
const { t } = useI18n()
const access = useDeveloperAccessStore()
const sessions = useChatSessionStore()
const cards = useAiriCardStore()
const local = useLocalVisionStore()
const prefix = 'settings.memory-admin.'
const overviewSchema = object({
  counts: record(string(), number()),
  characters: array(string()),
  persons: array(object({ person_id: string(), display_name: string() })),
  rules: array(object({ id: string(), text: string(), updated_at: number() })),
})
const memorySchema = object({
  memories: array(object({ event_id: string(), text: string(), at: number() })),
  face_extensions: array(object({ round_id: string(), count: number(), at: number() })),
})
const overview = ref<InferOutput<typeof overviewSchema>>()
const memories = ref<Array<{ event_id: string, text: string, at: number }>>([])
const faceExtensions = ref<Array<{ round_id: string, count: number, at: number }>>([])
const person = ref('')
const character = ref(cards.activeCardId || 'default')
const name = ref('')
const error = ref(false)
const busy = ref(false)
const pendingDelete = ref('')
let generation = 0

async function refresh() {
  const current = ++generation
  const value = parse(overviewSchema, await access.request('/admin/overview'))
  if (current !== generation || !access.authenticated)
    return
  overview.value = value
  if (person.value && !value.persons.some(item => item.person_id === person.value))
    person.value = ''
  name.value = value.persons.find(item => item.person_id === person.value)?.display_name ?? ''
}

async function readMemories() {
  memories.value = []
  faceExtensions.value = []
  name.value = overview.value?.persons.find(item => item.person_id === person.value)?.display_name ?? ''
  if (!person.value)
    return
  const current = ++generation
  const value = parse(memorySchema, await access.request(`/admin/persons/${encodeURIComponent(person.value)}?character=${encodeURIComponent(character.value)}`))
  if (current === generation && access.authenticated) {
    memories.value = value.memories
    faceExtensions.value = value.face_extensions
  }
}

async function perform(action: () => Promise<unknown>) {
  busy.value = true
  error.value = false
  try {
    await action()
  }
  catch { error.value = true }
  finally { busy.value = false }
}

async function save(path: string, body?: unknown, method = 'PATCH') {
  local.stop()
  await access.request(path, body, method)
  pendingDelete.value = ''
  await refresh()
  await readMemories()
}

watch([person, character], () => {
  void perform(readMemories)
})
onMounted(() => {
  void perform(refresh)
})
onScopeDispose(() => {
  generation++
})
</script>

<template>
  <section :class="['flex flex-col gap-4']">
    <p>{{ t(`${prefix}scope`) }}</p>
    <Button :disabled="busy" @click="perform(refresh)">
      {{ t(`${prefix}refresh`) }}
    </Button>
    <p v-if="error" role="alert">
      {{ t(`${prefix}operation-error`) }}
    </p>
    <template v-if="mode === 'short-term'">
      <p>{{ t(`${prefix}history-help`) }}</p>
      <article v-for="(messages, id) in sessions.sessionMessages" :key="id" :class="['flex flex-col gap-2 rounded-lg bg-neutral-100 p-3 dark:bg-neutral-900']">
        <h3>{{ sessions.sessionMetas[id]?.title || id }}</h3>
        <p v-for="(message, index) in messages" :key="index" :class="['whitespace-pre-wrap break-words text-sm']">
          {{ message.role }}: {{ extractMessageText(message) }}
        </p>
      </article>
    </template>
    <template v-else-if="overview">
      <div v-if="mode === 'database'" :class="['grid grid-cols-2 gap-3 sm:grid-cols-3']">
        <p v-for="(count, table) in overview.counts" :key="table">
          {{ table }}: {{ count }}
        </p>
      </div>
      <h3 :class="['font-semibold']">
        {{ t(`${prefix}rules`) }}
      </h3>
      <p>{{ t(`${prefix}rules-help`) }}</p>
      <div v-for="rule in overview.rules" :key="rule.id" :class="['flex flex-col gap-2']">
        <label :for="`rule-${rule.id}`">{{ rule.id }}</label>
        <Textarea :id="`rule-${rule.id}`" v-model="rule.text" :maxlength="2000" rows="4" />
        <Button :disabled="busy || !rule.text.trim()" @click="perform(() => save(`/admin/rules/${rule.id}`, { text: rule.text }))">
          {{ t(`${prefix}save`) }}
        </Button>
      </div>
      <FieldSelect v-model="person" :label="t(`${prefix}person`)" :placeholder="t(`${prefix}select-person`)" :options="overview.persons.map(item => ({ label: item.display_name, value: item.person_id }))" />
      <FieldInput v-model="character" :label="t(`${prefix}character`)" :description="t(`${prefix}character-help`)" />
      <template v-if="person">
        <FieldInput v-model="name" :label="t(`${prefix}name`)" :maxlength="64" />
        <Button :disabled="busy || !name.trim()" @click="perform(() => save(`/admin/persons/${person}`, { name }))">
          {{ t(`${prefix}save-name`) }}
        </Button>
        <h3 :class="['font-semibold']">
          {{ t(`${prefix}face-extensions`) }}
        </h3>
        <p>{{ t(`${prefix}face-extensions-help`) }}</p>
        <p v-if="!faceExtensions.length">
          {{ t(`${prefix}face-extensions-empty`) }}
        </p>
        <div v-for="batch in faceExtensions" :key="batch.round_id" :class="['flex flex-wrap items-center gap-2']">
          <p>{{ new Date(batch.at * 1000).toLocaleString() }} · {{ t(`${prefix}face-extensions-count`, { count: batch.count }) }}</p>
          <Button :disabled="busy" @click="pendingDelete = batch.round_id">
            {{ t(`${prefix}revoke-face-extensions`) }}
          </Button>
          <Button v-if="pendingDelete === batch.round_id" color="red" :disabled="busy" @click="perform(() => save(`/admin/persons/${person}/face-extensions/${encodeURIComponent(batch.round_id)}`, undefined, 'DELETE'))">
            {{ t(`${prefix}confirm-revoke-face-extensions`) }}
          </Button>
        </div>
        <div v-for="memory in memories" :key="memory.event_id" :class="['flex flex-col gap-2 rounded-lg bg-neutral-100 p-3 dark:bg-neutral-900']">
          <p>{{ new Date(memory.at * 1000).toLocaleString() }}</p>
          <Textarea v-model="memory.text" :aria-label="t(`${prefix}memory-text`)" :maxlength="2000" rows="3" />
          <div :class="['flex flex-wrap gap-2']">
            <Button :disabled="busy || !memory.text.trim()" @click="perform(() => save(`/admin/persons/${person}/memories/${encodeURIComponent(memory.event_id)}?character=${encodeURIComponent(character)}`, { text: memory.text }))">
              {{ t(`${prefix}save`) }}
            </Button>
            <Button :disabled="busy" @click="pendingDelete = memory.event_id">
              {{ t(`${prefix}delete-memory`) }}
            </Button>
            <Button v-if="pendingDelete === memory.event_id" color="red" :disabled="busy" @click="perform(() => save(`/admin/persons/${person}/memories/${encodeURIComponent(memory.event_id)}?character=${encodeURIComponent(character)}`, undefined, 'DELETE'))">
              {{ t(`${prefix}confirm-delete`) }}
            </Button>
          </div>
        </div>
        <p v-if="!memories.length">
          {{ t(`${prefix}empty`) }}
        </p>
        <Button color="red" :disabled="busy" @click="pendingDelete = 'person'">
          {{ t(`${prefix}delete-person`) }}
        </Button>
        <Button v-if="pendingDelete === 'person'" color="red" :disabled="busy" @click="perform(() => save(`/admin/persons/${person}`, undefined, 'DELETE'))">
          {{ t(`${prefix}confirm-delete-person`) }}
        </Button>
      </template>
      <p>{{ t(`${prefix}planned`) }}</p>
    </template>
  </section>
</template>
