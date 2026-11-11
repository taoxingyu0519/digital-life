// @vitest-environment node
import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, request as httpRequest } from 'node:http'
import { dirname, resolve } from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { sharedSettingsFixture } from '../../../packages/stage-ui/test/shared-settings'
import { SharedSettingsHost } from './shared-settings-gateway'

const workspace = resolve(import.meta.dirname, '../../../..')
const runtime = resolve(workspace, '.runtime')
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse())
    await cleanup()
})

async function fixture() {
  const directory = await mkdtemp(resolve(runtime, 'shared-settings-test-'))
  const file = resolve(directory, 'settings.bin')
  const host = new SharedSettingsHost(workspace, file)
  const server = createServer((request, response) => host.handle(request, response, () => response.writeHead(404).end()))
  await new Promise<void>(resolveReady => server.listen(0, '127.0.0.1', resolveReady))
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('server-address')
  const url = `http://127.0.0.1:${address.port}/api/shared-settings`
  cleanups.push(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolveClosed, reject) => server.close(error => error ? reject(error) : resolveClosed()))
    if (dirname(directory) !== runtime)
      throw new Error('test-cleanup-boundary')
    await rm(directory, { recursive: true, force: true })
  })
  const request = (body?: unknown, headers: Record<string, string> = {}) => new Promise<Response>((resolveResponse, reject) => {
    const pending = httpRequest(url, {
      method: body ? 'PUT' : 'GET',
      headers: { 'x-airi-settings': '1', 'Origin': new URL(url).origin, ...headers },
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolveResponse(new Response(Buffer.concat(chunks).toString(), { status: response.statusCode })))
      response.on('error', reject)
    })
    pending.on('error', reject)
    pending.end(body ? JSON.stringify(body) : undefined)
  })
  return { host, file, request }
}

// Local report: http://127.0.0.1:5174/#tasks/AIRI-039
// ROOT CAUSE: origin-local settings did not cross port/device boundaries. The loopback host now owns one revisioned copy.
it('aIRI-039 persists Chinese prompts and model credentials across host restart without plaintext on disk', async () => {
  const { file, request } = await fixture()
  expect(await (await request()).json()).toEqual({ revision: 0, settings: null })
  const settings = sharedSettingsFixture()
  settings.prompts.fast += '\n生成的中文同步验证规则。'
  settings.providers = [{ id: 'public-test-provider', definitionId: 'openai-compatible', added: true, config: { apiKey: 'generated-public-regression-key' } }]
  const saved = await request({ revision: 0, settings })
  expect(saved.status).toBe(200)
  expect((await saved.json()).revision).toBe(1)
  const encrypted = await readFile(file)
  expect(encrypted.includes(Buffer.from('generated-public-regression-key'))).toBe(false)
  const restarted = new SharedSettingsHost(workspace, file)
  expect(await restarted.read()).toEqual({ revision: 1, settings })
}, 20_000)

it('serializes competing host processes and retains the previous encrypted backup', async () => {
  const { host, file } = await fixture()
  const peer = new SharedSettingsHost(workspace, file)
  const first = sharedSettingsFixture()
  const second = sharedSettingsFixture()
  second.model.model = 'public-model-b'
  const results = await Promise.all([host.write({ revision: 0, settings: first }), peer.write({ revision: 0, settings: second })])
  expect(results.filter(result => result.conflict)).toHaveLength(1)
  const previous = await host.read()
  expect(previous.revision).toBe(1)
  const updated = await peer.write({ revision: 1, settings: second })
  expect(updated.conflict).toBe(false)
  expect(await new SharedSettingsHost(workspace, `${file}.backup`).read()).toEqual(previous)
}, 20_000)

it('rejects stale revisions with the current copy rather than overwriting newer edits', async () => {
  const { request } = await fixture()
  const settings = sharedSettingsFixture()
  await request({ revision: 0, settings })
  settings.model.model = 'stale-model'
  const response = await request({ revision: 0, settings })
  expect(response.status).toBe(409)
  expect((await response.json()).settings.model.model).toBe('')
}, 20_000)

it('allows the fixed SSH forwarding origin and rejects cross-origin or non-loopback entry names', async () => {
  const { request } = await fixture()
  expect((await request(undefined, { Host: '127.0.0.1:4173', Origin: 'http://127.0.0.1:4173' })).status).toBe(200)
  expect((await request(undefined, { Origin: 'https://outside.example' })).status).toBe(403)
  expect((await request(undefined, { Host: '192.168.1.2:5173', Origin: 'http://192.168.1.2:5173' })).status).toBe(403)
  expect((await request(undefined, { 'x-airi-settings': '' })).status).toBe(403)
}, 20_000)

it('invalid input and corrupt encrypted files cannot silently become default settings', async () => {
  const { request, file } = await fixture()
  const settings = sharedSettingsFixture()
  settings.conversation.delay = 999
  expect((await request({ revision: 0, settings })).status).toBe(400)
  await writeFile(file, 'generated-corrupt-data')
  expect((await request()).status).toBe(503)
  expect((await request({ revision: 0, settings: sharedSettingsFixture() })).status).toBe(503)
}, 25_000)

it('rejects oversized settings without replacing the last saved copy', async () => {
  const { request } = await fixture()
  const settings = sharedSettingsFixture()
  settings.providers = [{ id: 'oversized', definitionId: 'openai-compatible', added: true, config: { description: 'x'.repeat(1024 * 1024) } }]
  expect((await request({ revision: 0, settings })).status).toBe(413)
  expect((await (await request()).json()).revision).toBe(0)
})
