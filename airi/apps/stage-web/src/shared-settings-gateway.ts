import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Plugin } from 'vite'

import type { SharedSettingsSnapshot } from '../../../packages/stage-ui/src/services/shared-settings-contract'

import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rmdir, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import * as v from 'valibot'

import { sharedSettingsSnapshotSchema, sharedSettingsWriteSchema } from '../../../packages/stage-ui/src/services/shared-settings-contract'

/** Owns the encrypted host copy and an atomic revision boundary across host processes. */
export class SharedSettingsHost {
  private cached?: { encrypted: Buffer, snapshot: SharedSettingsSnapshot }

  constructor(private workspace: string, private file = resolve(workspace, 'airi/.local/shared-settings.bin')) {}

  private protect(data: Buffer, action: 'encrypt' | 'decrypt'): Promise<Buffer> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(resolve(this.workspace, '.runtime/vision-venv/Scripts/python.exe'), [resolve(this.workspace, 'scripts/protect-shared-settings.py'), action], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
      const chunks: Buffer[] = []
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error('secret-store-unavailable'))
      }, 10000)
      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
      child.on('error', () => {
        clearTimeout(timer)
        reject(new Error('secret-store-unavailable'))
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (code !== 0)
          reject(new Error('secret-store-unavailable'))
        else
          resolvePromise(Buffer.concat(chunks))
      })
      child.stdin.on('error', () => reject(new Error('secret-store-unavailable')))
      child.stdin.end(data)
    })
  }

  async read(): Promise<SharedSettingsSnapshot> {
    let encrypted: Buffer
    try {
      if ((await stat(this.file)).size > 2 * 1024 * 1024)
        throw new Error('shared-settings-size')
      encrypted = await readFile(this.file)
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { revision: 0, settings: null }
      throw error
    }
    if (this.cached?.encrypted.equals(encrypted))
      return this.cached.snapshot
    const plain = await this.protect(encrypted, 'decrypt')
    const snapshot = v.parse(sharedSettingsSnapshotSchema, JSON.parse(plain.toString('utf8')))
    this.cached = { encrypted, snapshot }
    return snapshot
  }

  async write(input: v.InferOutput<typeof sharedSettingsWriteSchema>) {
    await mkdir(dirname(this.file), { recursive: true })
    const lock = `${this.file}.lock`
    const deadline = Date.now() + 5000
    while (true) {
      try {
        await mkdir(lock)
        break
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || Date.now() > deadline)
          throw error
        await new Promise(resolveWait => setTimeout(resolveWait, 50))
      }
    }
    try {
      const current = await this.read()
      if (current.revision !== input.revision)
        return { conflict: true, snapshot: current }
      const snapshot = { revision: current.revision + 1, settings: input.settings }
      const encrypted = await this.protect(Buffer.from(JSON.stringify(snapshot)), 'encrypt')
      const temporary = `${this.file}.${randomUUID()}.tmp`
      await writeFile(temporary, encrypted, { flag: 'wx' })
      if (current.revision > 0)
        await writeFile(`${this.file}.backup`, await readFile(this.file))
      await rename(temporary, this.file)
      this.cached = { encrypted, snapshot }
      return { conflict: false, snapshot }
    }
    finally { await rmdir(lock) }
  }

  handle(request: IncomingMessage, response: ServerResponse, next: () => void) {
    if (request.url !== '/api/shared-settings')
      return next()
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    const host = request.headers.host ?? ''
    const hostname = host.split(':')[0]
    const remote = request.socket.remoteAddress
    if (!remote || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)
      || !['localhost', '127.0.0.1'].includes(hostname) || request.headers['x-airi-settings'] !== '1'
      || (request.headers.origin && request.headers.origin !== `http://${host}`)
      || (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin')) {
      response.writeHead(403).end('{"error":"origin"}')
      return
    }
    void (async () => {
      if (request.method === 'GET') {
        const snapshot = await this.read()
        response.writeHead(200).end(JSON.stringify(snapshot))
        return
      }
      if (request.method !== 'PUT') {
        response.writeHead(405).end('{"error":"method"}')
        return
      }
      request.setEncoding('utf8')
      let body = ''
      for await (const chunk of request) {
        body += chunk.toString()
        if (Buffer.byteLength(body) > 1024 * 1024) {
          response.writeHead(413).end('{"error":"size"}')
          return
        }
      }
      let input: v.InferOutput<typeof sharedSettingsWriteSchema>
      try {
        input = v.parse(sharedSettingsWriteSchema, JSON.parse(body))
      }
      catch {
        response.writeHead(400).end('{"error":"settings"}')
        return
      }
      const result = await this.write(input)
      response.writeHead(result.conflict ? 409 : 200).end(JSON.stringify(result.snapshot))
    })().catch(() => {
      if (!response.headersSent)
        response.writeHead(503).end('{"error":"unavailable"}')
    })
  }
}

/** Same host copy serves desktop localhost and the laptop's authenticated SSH forwarding origin. */
export function sharedSettingsPlugin(): Plugin {
  let host: SharedSettingsHost
  return {
    name: 'airi:shared-settings',
    configResolved(config) { host = new SharedSettingsHost(resolve(config.root, '../../..')) },
    configureServer(server) { server.middlewares.use((request, response, next) => host.handle(request, response, next)) },
    configurePreviewServer(server) { server.middlewares.use((request, response, next) => host.handle(request, response, next)) },
  }
}
