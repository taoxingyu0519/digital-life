import * as v from 'valibot'

/** Fixed same-origin routes. Callers never choose an upstream URL or program. */
export const FIRECRAWL_GATEWAY_PATH = '/api/web-search/firecrawl'
export const FIRECRAWL_CREDITS_PATH = `${FIRECRAWL_GATEWAY_PATH}/credits`

/** Search-only input shared with the local gateway. No scrape or paid options. */
export const firecrawlInputSchema = v.object({
  query: v.pipe(v.string(), v.minLength(2), v.maxLength(500)),
  limit: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10)),
  tbs: v.optional(v.pipe(v.string(), v.maxLength(40))),
})

/** Provider receipts remain separate from configured or locally inferred state. */
export const firecrawlResponseSchema = v.object({
  success: v.boolean(),
  id: v.optional(v.string()),
  creditsUsed: v.optional(v.pipe(v.number(), v.minValue(0))),
  data: v.optional(v.object({ web: v.optional(v.array(v.object({
    url: v.string(),
    title: v.optional(v.string(), ''),
    description: v.optional(v.string(), ''),
  })), []) })),
})

/** Credit usage comes from the authenticated provider, never a local counter. */
export const firecrawlCreditsSchema = v.object({
  success: v.boolean(),
  data: v.object({
    remainingCredits: v.pipe(v.number(), v.minValue(0)),
    planCredits: v.pipe(v.number(), v.minValue(0)),
    billingPeriodStart: v.optional(v.string()),
    billingPeriodEnd: v.optional(v.string()),
  }),
})

/** HTTP failures stop repeated model calls until configuration or a manual test changes. */
export class FirecrawlError extends Error {
  constructor(public readonly status: number, detail: string) {
    super(`web search failed: firecrawl ${status}: ${detail}`)
    this.name = 'FirecrawlError'
  }

  get requiresSetup() {
    return [401, 402, 403, 429, 503].includes(this.status)
  }
}

/** Removes credentials before a provider error reaches the model, UI or diagnostics. */
export function redactSearchError(detail: string, apiKey = ''): string {
  const withoutKey = apiKey ? detail.replaceAll(apiKey, '[redacted]') : detail
  return withoutKey.replace(/Bearer\s+\S+|fc-[\w-]+/gi, '[redacted]').replace(/[\p{Cc}<>]/gu, ' ').slice(0, 300)
}

/** Reads and redacts the provider's actual denial reason for search and credits. */
export async function readFirecrawlError(response: Response, apiKey = ''): Promise<FirecrawlError> {
  const payload: unknown = await response.json().catch(() => undefined)
  const detail = v.safeParse(v.object({ error: v.optional(v.string()), code: v.optional(v.string()), message: v.optional(v.string()) }), payload)
  const reason = detail.success ? [detail.output.code, detail.output.error ?? detail.output.message].filter(Boolean).join(': ') : ''
  return new FirecrawlError(response.status, redactSearchError(reason || 'Search service returned an invalid error response.', apiKey))
}
