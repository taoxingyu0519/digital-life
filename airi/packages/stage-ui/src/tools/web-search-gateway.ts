import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Plugin } from 'vite'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { errorMessageFrom } from '@moeru/std'

import * as v from 'valibot'

import { FIRECRAWL_CREDITS_PATH, FIRECRAWL_GATEWAY_PATH, firecrawlInputSchema, firecrawlResponseSchema, redactSearchError } from './web-search-contract'

const run = promisify(execFile)

class RequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

/** Owns the local HTTP boundary and aborts upstream work when the caller disconnects. */
class SearchGateway {
  private active = 0

  constructor(private readonly cliPath: string) {}

  private send(response: ServerResponse, status: number, payload: unknown) {
    if (!response.destroyed)
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(payload))
  }

  private async body(request: IncomingMessage, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      let text = ''
      function cleanup() {
        request.off('data', onData)
        request.off('end', onEnd)
        request.off('error', onError)
        request.off('aborted', onAborted)
        signal.removeEventListener('abort', onAborted)
      }
      function onError(error: Error) {
        cleanup()
        reject(error)
      }
      function onAborted() {
        onError(new RequestError(408, 'Search request was interrupted or timed out'))
      }
      function onData(chunk: string) {
        text += chunk
        if (Buffer.byteLength(text, 'utf8') > 8192)
          onError(new RequestError(413, 'Search request exceeds 8 KiB'))
      }
      function onEnd() {
        cleanup()
        try {
          resolve(JSON.parse(text))
        }
        catch {
          reject(new RequestError(400, 'Search request must contain JSON'))
        }
      }
      request.setEncoding('utf8')
      request.on('data', onData)
      request.once('end', onEnd)
      request.once('error', onError)
      request.once('aborted', onAborted)
      signal.addEventListener('abort', onAborted, { once: true })
    })
  }

  private async anonymous(input: v.InferOutput<typeof firecrawlInputSchema>, signal: AbortSignal): Promise<unknown> {
    const credentialsDirectory = process.platform === 'win32'
      ? join(homedir(), 'AppData', 'Roaming', 'firecrawl-cli')
      : process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support', 'firecrawl-cli') : join(homedir(), '.config', 'firecrawl-cli')
    if (process.env.FIRECRAWL_API_KEY || process.env.FIRECRAWL_API_URL || existsSync(join(credentialsDirectory, 'credentials.json')))
      throw new Error('Anonymous search cannot reuse configured CLI credentials. Configure a free-account key in Web search settings.')
    if (!existsSync(this.cliPath))
      throw new Error('Official Firecrawl CLI is unavailable. Configure a free-account key in Web search settings.')

    // The installed official CLI supplies its own attribution and keyless protocol.
    // We do not impersonate it by adding client headers to browser requests.
    const args = [this.cliPath, 'search', input.query, '--sources', 'web', '--limit', String(input.limit), '--no-highlights', '--json']
    if (input.tbs)
      args.push('--tbs', input.tbs)
    const { stdout } = await run(process.execPath, args, { signal, timeout: 20_000, maxBuffer: 256 * 1024, windowsHide: true })
    if (stdout.trim() === 'No results found.')
      return { success: true, data: { web: [] } }
    const payload: unknown = JSON.parse(stdout)
    const result = v.parse(firecrawlResponseSchema, payload)
    if (!result.success || !result.data)
      throw new Error('Official CLI returned an unsuccessful search response')
    return result
  }

  async handle(request: IncomingMessage, response: ServerResponse, credits: boolean) {
    const host = request.headers.host ?? ''
    const origin = request.headers.origin
    const localHost = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)
    if (!localHost || (origin && origin !== `http://${host}` && origin !== `https://${host}`)) {
      this.send(response, 403, { success: false, code: 'LOCAL_ORIGIN_REQUIRED', error: 'Search gateway only accepts same-origin local requests.' })
      return
    }
    if (request.method !== (credits ? 'GET' : 'POST')) {
      this.send(response, 405, { success: false, error: 'Method not allowed' })
      return
    }
    const apiKey = request.headers.authorization?.match(/^Bearer (\S{1,256})$/i)?.[1] ?? ''
    if (credits && !apiKey) {
      this.send(response, 401, { success: false, error: 'A Firecrawl account key is required to read credits.' })
      return
    }
    if (!credits && !request.headers['content-type']?.startsWith('application/json')) {
      this.send(response, 415, { success: false, error: 'Search request must use application/json' })
      return
    }
    if (this.active >= 2) {
      this.send(response, 429, { success: false, error: 'Two search requests are already in progress.' })
      return
    }
    const abort = new AbortController()
    const onClose = () => abort.abort()
    response.once('close', onClose)
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(22_000)])
    this.active++
    try {
      const input = credits ? undefined : v.parse(firecrawlInputSchema, await this.body(request, signal))
      if (!apiKey && input) {
        this.send(response, 200, await this.anonymous(input, signal))
        return
      }
      // Only explicit Firecrawl credentials and content type cross this boundary.
      // Cookies, LAN tickets, origin, forwarded headers and provider URLs do not.
      const upstream = await fetch(`https://api.firecrawl.dev/v2/${credits ? 'team/credit-usage' : 'search'}`, {
        method: credits ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        ...(input ? { body: JSON.stringify({ ...input, sources: [{ type: 'web' }], timeout: 10000 }) } : {}),
        signal,
      })
      const payload: unknown = await upstream.json().catch(() => ({ success: false, error: 'Firecrawl returned a non-JSON response.' }))
      if (upstream.ok) {
        this.send(response, upstream.status, payload)
      }
      else {
        const failure = v.safeParse(v.object({ code: v.optional(v.string()), error: v.optional(v.string()), message: v.optional(v.string()) }), payload)
        this.send(response, upstream.status, {
          success: false,
          code: failure.success && failure.output.code ? redactSearchError(failure.output.code, apiKey) : undefined,
          error: redactSearchError(failure.success ? failure.output.error ?? failure.output.message ?? 'Firecrawl denied the request.' : 'Firecrawl returned an invalid error response.', apiKey),
        })
      }
    }
    catch (error) {
      const status = error instanceof RequestError ? error.status : v.isValiError(error) ? 400 : 503
      const cliFailure = v.safeParse(v.object({ stderr: v.string() }), error)
      const detail = cliFailure.success && cliFailure.output.stderr.trim() ? cliFailure.output.stderr : errorMessageFrom(error) ?? 'Local search failed'
      this.send(response, status, { success: false, error: redactSearchError(detail, apiKey) })
    }
    finally {
      this.active--
      response.off('close', onClose)
    }
  }
}

/**
 * Adds the fixed search-only proxy to local Web development and preview.
 *
 * Call stack:
 * Vite middleware -> SearchGateway.handle -> official CLI or authenticated Firecrawl REST
 */
export function firecrawlSearchPlugin(cliPath: string): Plugin {
  const gateway = new SearchGateway(cliPath)
  const attach = (server: { middlewares: { use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void } }) => {
    server.middlewares.use((request, response, next) => {
      const path = request.url?.split('?')[0]
      if (path !== FIRECRAWL_GATEWAY_PATH && path !== FIRECRAWL_CREDITS_PATH) {
        next()
        return
      }
      void gateway.handle(request, response, path === FIRECRAWL_CREDITS_PATH)
    })
  }
  return { name: 'airi:firecrawl-search', configureServer: attach, configurePreviewServer: attach }
}
