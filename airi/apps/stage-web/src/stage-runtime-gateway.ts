import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Plugin } from 'vite'

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { platform } from 'node:process'
import { promisify } from 'node:util'

import * as v from 'valibot'

const run = promisify(execFile)
const visionReplySchema = v.object({ ready: v.optional(v.boolean()), camera_connected: v.optional(v.boolean()), idle: v.optional(v.boolean()) })

/** Fixed local process controls. Requests cannot supply a program, path, credential or argument. */
export function stageRuntimePlugin(): Plugin {
  let workspace: string
  let queue = Promise.resolve()

  async function vision(path: 'health' | 'runtime/wake' | 'runtime/sleep'): Promise<v.InferOutput<typeof visionReplySchema>> {
    const credential = (await readFile(resolve(workspace, 'airi/.local/vision/credential'), 'utf8')).trim()
    const response = await fetch(`http://127.0.0.1:18765/${path}`, {
      method: path === 'health' ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${credential}` },
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok)
      throw new Error('vision-unavailable')
    return v.parse(visionReplySchema, await response.json())
  }

  async function control(action: 'wake' | 'sleep'): Promise<string> {
    if (platform !== 'win32')
      return 'unavailable'
    if (action === 'wake') {
      if (!(await vision('health').catch(() => undefined))?.ready) {
        await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve(workspace, 'scripts/vision.ps1'), 'start'], { windowsHide: true, timeout: 20000 })
      }
      // Loading CUDA models takes longer than spawning the interpreter. Readiness is evidence, not a timer.
      const deadline = Date.now() + 45000
      do {
        if ((await vision('health').catch(() => undefined))?.ready) {
          await vision('runtime/wake')
          return 'ready'
        }
        await new Promise(resolve => setTimeout(resolve, 500))
      } while (Date.now() < deadline)
      return 'unavailable'
    }
    // A different camera owner keeps its server. Closing this renderer must not interrupt another client.
    for (let attempt = 0; attempt < 10; attempt++) {
      const status = await vision('runtime/sleep').catch(() => undefined)
      if (status?.idle)
        break
      // An unreachable service can already be stopped. The script still verifies recorded PID ownership.
      if (!status && !(await vision('health').catch(() => undefined)))
        break
      if (attempt === 9)
        return 'busy'
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve(workspace, 'scripts/vision.ps1'), 'stop'], { windowsHide: true, timeout: 20000 })
    // An unrecorded listener cannot be called stopped. The ownership guard never kills it.
    return await vision('health').then(() => 'unavailable', () => 'stopped')
  }

  function handle(request: IncomingMessage, response: ServerResponse, next: () => void) {
    if (!request.url?.startsWith('/api/stage-runtime/'))
      return next()
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    const host = request.headers.host ?? ''
    if (!['127.0.0.1:5173', 'localhost:5173', '127.0.0.1:4173', 'localhost:4173'].includes(host)
      || request.headers['x-airi-runtime'] !== '1'
      || (request.headers.origin && request.headers.origin !== `http://${host}`)
      || (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin')) {
      response.writeHead(403).end('{"error":"origin"}')
      return
    }
    const action = request.url === '/api/stage-runtime/wake' ? 'wake' : request.url === '/api/stage-runtime/sleep' ? 'sleep' : undefined
    if (!action || request.method !== 'POST' || Number(request.headers['content-length'] ?? 0) !== 0 || request.headers['transfer-encoding']) {
      response.writeHead(400).end('{"error":"request"}')
      return
    }
    // Process transitions remain ordered even when the renderer cancels a pending start.
    queue = queue.then(async () => {
      const result = await control(action).catch(() => 'unavailable')
      if (!response.destroyed)
        response.writeHead(200).end(JSON.stringify({ vision: result }))
    })
  }

  return {
    name: 'airi:stage-runtime',
    configResolved(config) { workspace = resolve(config.root, '../../..') },
    configureServer(server) { server.middlewares.use(handle) },
    configurePreviewServer(server) { server.middlewares.use(handle) },
  }
}
