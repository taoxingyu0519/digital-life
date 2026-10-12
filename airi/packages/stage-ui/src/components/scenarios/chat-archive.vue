<script setup lang="ts">
import type { ArchiveMessage, ArchivePage, ArchivePartner } from '../../types/chat-archive'

import { Button, FieldInput, Textarea } from '@proj-airi/ui'
import { computed, onScopeDispose, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useChatStore } from '../../stores/chat'
import { useChatArchiveStore } from '../../stores/chat-archive'
import { useDeveloperAccessStore } from '../../stores/developer-access'
import { useAiriCardStore } from '../../stores/modules/airi-card'
import { useStageIdentityStore } from '../../stores/stage-identity'

const archive = useChatArchiveStore()
const identity = useStageIdentityStore()
const access = useDeveloperAccessStore()
const cards = useAiriCardStore()
const chat = useChatStore()
const { t, locale } = useI18n()
const prefix = 'settings.chat-archive.'
const partners = ref<ArchivePartner[]>([])
const selected = ref<ArchivePartner>()
const page = ref<ArchivePage>({ messages: [], total: 0, nextCursor: null })
const peopleSearch = ref('')
const query = ref('')
const date = ref('')
const starred = ref(false)
const all = ref(false)
const busy = ref(false)
const error = ref(false)
const editor = ref<ArchiveMessage>()
const neighbors = ref<ArchiveMessage[]>([])
const note = ref('')
const summary = ref('')
const tags = ref('')
const favorite = ref(false)
const pendingDelete = ref(false)
let generation = 0

const visiblePartners = computed(() => partners.value.filter(partner => partner.displayName.toLocaleLowerCase().includes(peopleSearch.value.toLocaleLowerCase())))
const canEdit = computed(() => !!editor.value?.messageId)
const canDelete = computed(() => canEdit.value && selected.value?.userId === identity.userId)

function name(partner: ArchivePartner) {
  return partner.displayName || t(`${prefix}${partner.userId === 'local' ? 'guest' : 'unnamed'}`)
}
function characterName(id: string) {
  return cards.cards.get(id)?.name || t(`${prefix}character`)
}
function time(value: number | null) {
  return value === null ? t(`${prefix}unknown-time`) : new Date(value).toLocaleString(locale.value)
}
function day(message: ArchiveMessage) {
  return message.at === null ? t(`${prefix}unknown-time`) : new Date(message.at).toLocaleDateString(locale.value)
}

function clear() {
  generation++
  partners.value = []
  selected.value = undefined
  page.value = { messages: [], total: 0, nextCursor: null }
  editor.value = undefined
  neighbors.value = []
  pendingDelete.value = false
}

async function load(older = false) {
  if (!selected.value)
    return
  const current = ++generation
  const partner = selected.value
  busy.value = true
  error.value = false
  try {
    const from = date.value ? new Date(`${date.value}T00:00:00`).getTime() : undefined
    const to = date.value ? new Date(`${date.value}T23:59:59.999`).getTime() : undefined
    const next = await archive.query(partner.userId, partner.characterId, { query: query.value, from, to, starred: starred.value, ...(older && page.value.nextCursor ? { cursor: page.value.nextCursor } : {}) })
    if (current !== generation)
      return
    page.value = older ? { ...next, messages: [...next.messages, ...page.value.messages] } : next
  }
  catch {
    if (current === generation)
      error.value = true
  }
  finally {
    if (current === generation)
      busy.value = false
  }
}

async function refresh() {
  const current = ++generation
  busy.value = true
  error.value = false
  try {
    const next = await archive.partners(all.value)
    if (current !== generation)
      return
    partners.value = next
    selected.value = next.find(partner => partner.userId === selected.value?.userId && partner.characterId === selected.value?.characterId)
      ?? next.find(partner => partner.userId === identity.userId && partner.characterId === (cards.activeCardId || 'default')) ?? next[0]
    await load()
  }
  catch {
    if (current === generation)
      error.value = true
  }
  finally {
    if (current === generation)
      busy.value = false
  }
}

async function select(partner: ArchivePartner) {
  generation++
  selected.value = partner
  editor.value = undefined
  neighbors.value = []
  page.value = { messages: [], total: 0, nextCursor: null }
  await load()
}

async function open(message: ArchiveMessage) {
  if (!selected.value || !message.messageId)
    return
  const current = ++generation
  editor.value = message
  note.value = message.annotation?.note ?? ''
  summary.value = message.annotation?.summary ?? ''
  tags.value = message.annotation?.tags.join(', ') ?? ''
  favorite.value = message.annotation?.starred ?? false
  pendingDelete.value = false
  neighbors.value = []
  try {
    const next = await archive.context(selected.value.userId, selected.value.characterId, message.sessionId, message.messageId)
    if (current === generation)
      neighbors.value = next
  }
  catch {
    if (current === generation)
      error.value = true
  }
}

async function save() {
  if (!editor.value?.messageId || !selected.value)
    return
  busy.value = true
  try {
    await archive.annotate(selected.value.userId, selected.value.characterId, editor.value.sessionId, editor.value.messageId, { starred: favorite.value, note: note.value, summary: summary.value, tags: tags.value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean) })
    editor.value = undefined
    await load()
  }
  catch { error.value = true }
  finally { busy.value = false }
}

async function remove() {
  if (!editor.value?.messageId || !selected.value || !canDelete.value)
    return
  busy.value = true
  try {
    await chat.cancelPendingSends(editor.value.sessionId)
    await archive.remove(selected.value.userId, selected.value.characterId, editor.value.sessionId, editor.value.messageId)
    editor.value = undefined
    neighbors.value = []
    pendingDelete.value = false
    await refresh()
  }
  catch { error.value = true }
  finally { busy.value = false }
}

async function download() {
  if (!selected.value)
    return
  try {
    const result = await archive.exportRecords(selected.value.userId, selected.value.characterId)
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'airi-chat-archive.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  catch { error.value = true }
}

watch(() => [identity.userId, identity.displayName, cards.activeCardId, access.authenticated], () => {
  clear()
  if (!access.authenticated)
    all.value = false
  void refresh()
}, { flush: 'sync' })
watch(() => archive.revision, () => {
  editor.value = undefined
  neighbors.value = []
  void refresh()
})
watch(all, () => {
  clear()
  void refresh()
})
onScopeDispose(clear)
void refresh()
</script>

<template>
  <section :aria-label="t(`${prefix}title`)" :class="['flex flex-col gap-4 rounded-2xl bg-white p-4 text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100']">
    <div :class="['flex flex-wrap items-center justify-between gap-3']">
      <div>
        <h2 :class="['text-xl font-semibold']">
          {{ t(`${prefix}title`) }}
        </h2>
        <p :class="['mt-1 text-sm text-neutral-500 dark:text-neutral-400']">
          {{ t(`${prefix}description`) }}
        </p>
      </div>
      <div :class="['flex gap-2']">
        <Button v-if="access.authenticated" :aria-pressed="all" @click="all = !all">
          {{ t(`${prefix}${all ? 'self' : 'all'}`) }}
        </Button>
        <Button :disabled="busy" @click="refresh">
          {{ t(`${prefix}refresh`) }}
        </Button>
      </div>
    </div>
    <p v-if="error" role="alert" :class="['text-sm text-red-600 dark:text-red-400']">
      {{ t(`${prefix}error`) }}
    </p>
    <div :class="['grid min-h-96 overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950', 'md:grid-cols-[240px_minmax(0,1fr)]']">
      <aside :class="['flex flex-col gap-3 border-b border-neutral-200 p-4 dark:border-neutral-800 md:border-b-0 md:border-r']">
        <FieldInput v-model="peopleSearch" :label="t(`${prefix}people-search`)" />
        <div :class="['max-h-64 flex flex-col gap-2 overflow-y-auto md:max-h-150']">
          <Button v-for="partner in visiblePartners" :key="`${partner.userId}:${partner.characterId}`" :color="partner.userId === selected?.userId && partner.characterId === selected?.characterId ? 'primary' : 'neutral'" :aria-pressed="partner.userId === selected?.userId && partner.characterId === selected?.characterId" :class="['h-auto w-full text-left']" @click="select(partner)">
            <span :class="['w-full flex items-start gap-3']">
              <span :class="['size-9 shrink-0 flex items-center justify-center rounded-full bg-primary-100 text-primary-600 dark:bg-primary-900/30']">{{ name(partner).slice(0, 1) }}</span>
              <span :class="['min-w-0 flex-1']">
                <span :class="['block truncate font-medium']">{{ name(partner) }}</span>
                <span :class="['block truncate text-xs opacity-65']">{{ characterName(partner.characterId) }} · {{ time(partner.updatedAt) }}</span>
                <span :class="['mt-1 block truncate text-xs opacity-75']">{{ partner.preview }}</span>
              </span>
            </span>
          </Button>
        </div>
        <p v-if="!visiblePartners.length" :class="['text-sm text-neutral-500']">
          {{ t(`${prefix}no-people`) }}
        </p>
        <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t(`${prefix}scope`) }}
        </p>
      </aside>
      <div :class="['min-w-0 flex flex-col gap-4 p-4']">
        <template v-if="selected">
          <div :class="['flex flex-wrap items-center justify-between gap-2']">
            <h3 :class="['font-semibold']">
              {{ name(selected) }} · {{ characterName(selected.characterId) }}
            </h3>
            <Button :disabled="busy" @click="download">
              {{ t(`${prefix}export`) }}
            </Button>
          </div>
          <form :class="['grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_160px_auto]']" @submit.prevent="load()">
            <FieldInput v-model="query" :label="t(`${prefix}search`)" :placeholder="t(`${prefix}search-placeholder`)" />
            <FieldInput v-model="date" type="date" :label="t(`${prefix}date`)" />
            <Button type="submit" :disabled="busy">
              {{ t(`${prefix}find`) }}
            </Button>
          </form>
          <div :class="['flex items-center justify-between gap-2 text-xs text-neutral-500']">
            <span>{{ t(`${prefix}count`, { count: page.total }) }}</span>
            <Button :aria-pressed="starred" @click="starred = !starred; load()">
              {{ t(`${prefix}favorites`) }}
            </Button>
          </div>
          <div :class="['max-h-150 min-h-64 flex flex-col gap-4 overflow-y-auto p-2']" :aria-busy="busy" :aria-label="t(`${prefix}timeline`)">
            <Button v-if="page.nextCursor" :disabled="busy" @click="load(true)">
              {{ t(`${prefix}older`) }}
            </Button>
            <article v-for="(message, index) in page.messages" :key="`${message.sessionId}:${message.messageId ?? message.position}`" :data-message-id="message.messageId" :class="['flex flex-col gap-1', message.role === 'user' ? 'items-end' : 'items-start']">
              <p v-if="index === 0 || day(message) !== day(page.messages[index - 1])" :class="['my-2 w-full text-center text-xs text-neutral-500']">
                {{ day(message) }}
              </p>
              <span :class="['text-xs text-neutral-500']">{{ message.role === 'user' ? name(selected) : characterName(selected.characterId) }} · {{ time(message.at) }}</span>
              <div :class="['max-w-[92%] rounded-2xl px-4 py-3 text-sm shadow-sm', message.role === 'user' ? 'bg-primary-100 text-primary-950 dark:bg-primary-900/30 dark:text-primary-100' : 'bg-white text-neutral-800 dark:bg-neutral-900 dark:text-neutral-100']">
                <p :class="['whitespace-pre-wrap break-words']">
                  {{ message.text }}
                </p>
                <p v-if="message.attachments" :class="['mt-2 text-xs opacity-65']">
                  {{ t(`${prefix}attachments`, { count: message.attachments }) }}
                </p>
                <p v-if="message.interrupted" :class="['mt-2 text-xs opacity-65']">
                  {{ t(`${prefix}interrupted`) }}
                </p>
                <p v-if="message.annotation?.starred" :class="['mt-2 text-xs text-primary-600']">
                  ★ {{ t(`${prefix}favorite`) }}
                </p>
                <p v-if="message.annotation?.summary" :class="['mt-2 border-t border-neutral-200 pt-2 text-xs dark:border-neutral-700']">
                  {{ t(`${prefix}summary`) }}：{{ message.annotation.summary }}
                </p>
                <p v-if="message.annotation?.note" :class="['mt-1 text-xs opacity-75']">
                  {{ t(`${prefix}note`) }}：{{ message.annotation.note }}
                </p>
                <span v-for="tag in message.annotation?.tags" :key="tag" :class="['mr-1 mt-2 inline-block rounded-full bg-neutral-200/50 px-2 py-0.5 text-xs dark:bg-neutral-800']">{{ tag }}</span>
              </div>
              <Button v-if="message.messageId" size="sm" :aria-label="t(`${prefix}open-message`)" @click="open(message)">
                {{ t(`${prefix}more`) }}
              </Button>
            </article>
            <p v-if="!page.messages.length" :class="['py-8 text-center text-sm text-neutral-500']">
              {{ t(`${prefix}empty`) }}
            </p>
          </div>
          <section v-if="editor" :aria-label="t(`${prefix}source`)" :class="['flex flex-col gap-3 rounded-xl border border-primary-200 p-4 dark:border-primary-900']">
            <div :class="['flex items-center justify-between gap-2']">
              <h4 :class="['font-medium']">
                {{ t(`${prefix}source`) }}
              </h4><Button @click="editor = undefined; neighbors = []">
                {{ t(`${prefix}close`) }}
              </Button>
            </div>
            <p v-for="neighbor in neighbors" :key="`${neighbor.sessionId}:${neighbor.position}`" :class="['whitespace-pre-wrap break-words text-sm', neighbor.messageId === editor.messageId ? 'font-semibold' : 'opacity-65']">
              {{ neighbor.role === 'user' ? name(selected) : characterName(selected.characterId) }}：{{ neighbor.text }}
            </p>
            <Button :aria-pressed="favorite" @click="favorite = !favorite">
              {{ t(`${prefix}favorite`) }}
            </Button>
            <label :class="['flex flex-col gap-2 text-sm']">{{ t(`${prefix}summary`) }}<Textarea v-model="summary" :maxlength="2000" :aria-label="t(`${prefix}summary`)" rows="2" /></label>
            <label :class="['flex flex-col gap-2 text-sm']">{{ t(`${prefix}note`) }}<Textarea v-model="note" :maxlength="2000" :aria-label="t(`${prefix}note`)" rows="2" /></label>
            <FieldInput v-model="tags" :label="t(`${prefix}tags`)" :description="t(`${prefix}tags-help`)" />
            <div :class="['flex flex-wrap gap-2']">
              <Button :disabled="busy || !canEdit" @click="save">
                {{ t(`${prefix}save`) }}
              </Button><Button v-if="canDelete" color="red" :disabled="busy" @click="pendingDelete = true">
                {{ t(`${prefix}delete`) }}
              </Button>
            </div>
            <div v-if="pendingDelete" role="alert" :class="['flex flex-col gap-2 rounded-lg bg-red-50 p-3 dark:bg-red-950/20']">
              <p>{{ t(`${prefix}delete-help`) }}</p><div :class="['flex gap-2']">
                <Button color="red" :disabled="busy" @click="remove">
                  {{ t(`${prefix}confirm-delete`) }}
                </Button><Button @click="pendingDelete = false">
                  {{ t(`${prefix}cancel`) }}
                </Button>
              </div>
            </div>
          </section>
        </template>
        <p v-else :class="['py-12 text-center text-sm text-neutral-500']">
          {{ t(`${prefix}empty`) }}
        </p>
      </div>
    </div>
  </section>
</template>
