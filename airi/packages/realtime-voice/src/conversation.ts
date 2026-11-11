import type { ThinkingResult } from './brain'
import type { BrainPromptSettings } from './prompts'

import * as v from 'valibot'

import { conversationStyleSchema } from './conversation-contract'
import { brainPromptDefaults } from './prompts'

export { continuationDelaySchema, conversationStyles, conversationStyleSchema } from './conversation-contract'
export type { ConversationStyle } from './conversation-contract'

export const continuationOutputSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(400), v.check(text => !text.startsWith('{') && !text.includes('```') && !/<(?:think|reasoning)[\s>]/i.test(text), 'Speech must not contain JSON, reasoning or code blocks'))

/** Safe diagnostics contain no request headers, prompt, response body, or private reasoning. */
export class ContinuationError extends Error {
  constructor(readonly code: 'provider' | 'http' | 'network' | 'output', readonly httpStatus?: number) {
    super(httpStatus ? `Continuation ${code} ${httpStatus}` : `Continuation ${code}`)
  }
}

/** Call-local failure details displayed by the voice panel and discarded when the call ends. */
export interface ContinuationFailure {
  code: ContinuationError['code'] | 'timeout' | 'generation'
  elapsedMs: number
  httpStatus?: number
}

/** Host facts about heard automatic segments. The model chooses wording and interprets silence tentatively. */
export interface ContinuationContext {
  phase: 'greeting' | 'opening' | 'gentle_probe' | 'change_topic' | 'develop_topic'
  unanswered_segments: number
  remaining_probe_opportunities: number
}

/** Requests one short piece from the selected model. This is an application event, never a user message. */
export const continuationInstructions = `${brainPromptDefaults.styles.chatty}
${brainPromptDefaults.continuation}`

/** Projects a user-selected style into both model prompts. Invalid stored values use the default natural style. */
export function conversationPolicy(value: unknown, prompts: BrainPromptSettings = brainPromptDefaults) {
  const parsed = v.safeParse(conversationStyleSchema, value)
  const style = parsed.success ? parsed.output : 'natural'
  return {
    style,
    fastInstructions: style === 'basic' ? '' : `Current conversation style: ${style}\n${prompts.core}\n${prompts.styles[style]}`,
    workerInstructions: `Current conversation style: ${style}. ${prompts.styles[style]}
${prompts.result}`,
    // This is a waiting check, not a universal silence or awkwardness threshold. It emits at most once per version.
    waitNoticeAfterMs: style === 'natural' ? 15000 : undefined,
    // Prototype limits, not psychological thresholds. One request at a time, with no silent background polling.
    continuation: style === 'chatty' ? { maxRequests: 30, timeoutMs: 45000 } : undefined,
  }
}

/** Splits canonical findings for the TTS transport without rewriting or dropping any character. */
export function resultSpeechChunks(result: ThinkingResult) {
  const chunks: string[] = []
  let remaining = result.result_summary
  while (remaining.length > 400) {
    const window = remaining.slice(0, 400)
    let end = Math.max(...['。', '！', '？', '；', '\n', ' '].map(separator => window.lastIndexOf(separator))) + 1
    if (!end)
      end = 400
    if (/[\uD800-\uDBFF]/.test(remaining[end - 1]))
      end--
    chunks.push(remaining.slice(0, end))
    remaining = remaining.slice(end)
  }
  if (remaining)
    chunks.push(remaining)
  return chunks
}
