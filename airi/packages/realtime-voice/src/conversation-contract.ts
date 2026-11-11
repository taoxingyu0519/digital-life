import * as v from 'valibot'

/** Neutral persistence contract shared by browser policy and host configuration. */
export const conversationStyles = ['basic', 'natural', 'concise', 'listening', 'chatty'] as const
export const conversationStyleSchema = v.picklist(conversationStyles)
export type ConversationStyle = v.InferOutput<typeof conversationStyleSchema>
export const continuationDelaySchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(120))
