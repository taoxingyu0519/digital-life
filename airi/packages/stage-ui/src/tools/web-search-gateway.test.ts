import type { AddressInfo } from 'node:net'

import { request } from 'node:http'

import { createServer } from 'vite'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FIRECRAWL_CREDITS_PATH, FIRECRAWL_GATEWAY_PATH } from './web-search-contract'
import { firecrawlSearchPlugin } from './web-search-gateway'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0))
    await cleanup()
})

async function fixture() {
  const server = await createServer({ configFile: false, logLevel: 'silent', server: { host: '127.0.0.1', port: 0 }, plugins: [firecrawlSearchPlugin('/missing/firecrawl-cli')] })
  await server.listen()
  cleanups.push(() => server.close())
  const port = (server.httpServer!.address() as AddressInfo).port
  // Native HTTP leaves the upstream fetch mock confined to the vendor boundary.
  const send = (options: { path?: string, method?: string, headers?: Record<string, string>, body?: string } = {}) => new Promise<{ status: number, body: string }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: options.path ?? FIRECRAWL_GATEWAY_PATH, method: options.method ?? 'POST', headers: { 'content-type': 'application/json', 'authorization': 'Bearer fc-test-account', ...options.headers } }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => {
        body += chunk
      })
      res.on('end', () => resolve({ status: res.statusCode!, body }))
    })
    req.on('error', reject)
    req.end(options.method === 'GET' ? undefined : options.body ?? JSON.stringify({ query: 'current public weather', limit: 3 }))
  })
  return { send, port }
}

describe('local Firecrawl HTTP boundary', () => {
  it('forwards only search input and explicit credentials, preserving the provider receipt', async () => {
    const { send, port } = await fixture()
    const receipt = { success: true, id: 'provider-receipt', creditsUsed: 2, data: { web: [{ url: 'https://source.example/', title: 'Weather' }] } }
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(receipt)))
    const res = await send({ headers: { origin: `http://127.0.0.1:${port}`, cookie: 'private-session=must-not-forward' }, body: JSON.stringify({ query: 'current public weather', limit: 3, apiKey: 'must-not-forward', scrapeOptions: { formats: ['markdown'] }, url: 'https://elsewhere.example/' }) })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual(receipt)
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://api.firecrawl.dev/v2/search')
    expect(Object.fromEntries(new Headers(init?.headers))).toEqual({ 'authorization': 'Bearer fc-test-account', 'content-type': 'application/json' })
    expect(JSON.parse(String(init?.body))).toEqual({ query: 'current public weather', limit: 3, sources: [{ type: 'web' }], timeout: 10000 })
  })

  it('preserves a real HTTP denial and redacts credentials without breaking JSON', async () => {
    const { send } = await fixture()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ code: 'ACCESS_DENIED', error: `Denied fc-test-account ${'x'.repeat(350)}` }), { status: 403 }))
    const res = await send()
    expect(res.status).toBe(403)
    expect(JSON.parse(res.body)).toMatchObject({ success: false, code: 'ACCESS_DENIED' })
    expect(res.body).toContain('[redacted]')
    expect(res.body).not.toContain('fc-test-account')
  })

  it('rejects foreign origins, invalid input and unsupported operations before contacting Firecrawl', async () => {
    const { send } = await fixture()
    const fetch = vi.spyOn(globalThis, 'fetch')
    expect((await send({ headers: { origin: 'https://foreign.example' } })).status).toBe(403)
    expect((await send({ method: 'DELETE' })).status).toBe(405)
    expect((await send({ body: JSON.stringify({ query: 'weather', limit: 100 }) })).status).toBe(400)
    expect((await send({ body: 'not-json' })).status).toBe(400)
    expect((await send({ body: 'x'.repeat(8193) })).status).toBe(413)
    expect((await send({ headers: { 'content-type': 'text/plain' } })).status).toBe(415)
    expect((await send({ method: 'GET', path: FIRECRAWL_CREDITS_PATH, headers: { authorization: '' } })).status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reads credit balance only through the official authenticated endpoint', async () => {
    const { send } = await fixture()
    const payload = { success: true, data: { remainingCredits: 876, planCredits: 1000 } }
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(payload)))
    const res = await send({ method: 'GET', path: FIRECRAWL_CREDITS_PATH })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual(payload)
    expect(fetch.mock.calls[0][0]).toBe('https://api.firecrawl.dev/v2/team/credit-usage')
    expect(fetch.mock.calls[0][1]?.method).toBe('GET')
    expect(fetch.mock.calls[0][1]?.body).toBeUndefined()
  })

  it('reports a missing official CLI instead of falling back to browser anonymous HTTP', async () => {
    const { send } = await fixture()
    const fetch = vi.spyOn(globalThis, 'fetch')
    const res = await send({ headers: { authorization: '' } })
    expect(res.status).toBe(503)
    expect(res.body).toContain('free-account key')
    expect(fetch).not.toHaveBeenCalled()
  })
})
