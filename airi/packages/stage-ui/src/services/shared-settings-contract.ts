import { continuationDelaySchema, conversationStyleSchema } from '@proj-airi/realtime-voice/conversation-contract'
import { brainPromptSchema } from '@proj-airi/realtime-voice/prompts'

import * as v from 'valibot'

const identifier = v.pipe(v.string(), v.maxLength(160))
const text = v.pipe(v.string(), v.maxLength(16384))
/** Browser speech recognition carries local language/device policy, rather than transferable service credentials. */
export const deviceProviderDefinitions: ReadonlySet<string> = new Set(['browser-web-speech-api'])
const providerSchema = v.strictObject({
  id: identifier,
  definitionId: identifier,
  config: v.record(identifier, v.unknown()),
  added: v.boolean(),
})

/** Shared agent configuration excludes accounts, history, device permissions and running state. */
export const sharedSettingsSchema = v.strictObject({
  prompts: brainPromptSchema,
  providers: v.pipe(v.array(providerSchema), v.maxLength(100), v.check(rows => new Set(rows.map(row => row.id)).size === rows.length)),
  model: v.strictObject({
    provider: identifier,
    model: identifier,
    customModel: identifier,
    temperature: v.pipe(v.number(), v.minValue(0), v.maxValue(2)),
    topP: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
    reasoning: v.boolean(),
    temperatureEnabled: v.boolean(),
    topPEnabled: v.boolean(),
  }),
  conversation: v.strictObject({
    style: conversationStyleSchema,
    delay: continuationDelaySchema,
    textInput: v.boolean(),
  }),
  search: v.strictObject({
    enabled: v.boolean(),
    provider: v.picklist(['firecrawl', 'tavily']),
    apiKey: text,
    firecrawlApiKey: text,
  }),
})

export type SharedSettings = v.InferOutput<typeof sharedSettingsSchema>

/** Revision zero has no shared copy. Compare-and-swap prevents stale devices from replacing newer edits. */
export const sharedSettingsSnapshotSchema = v.strictObject({
  revision: v.pipe(v.number(), v.integer(), v.minValue(0)),
  settings: v.nullable(sharedSettingsSchema),
})
export type SharedSettingsSnapshot = v.InferOutput<typeof sharedSettingsSnapshotSchema>
export const sharedSettingsWriteSchema = v.strictObject({
  revision: v.pipe(v.number(), v.integer(), v.minValue(0)),
  settings: sharedSettingsSchema,
})
