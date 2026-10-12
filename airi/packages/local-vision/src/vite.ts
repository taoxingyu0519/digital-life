import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Plugin } from 'vite'

import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/** The same-origin control proxy keeps the service credential outside the renderer. */
export function localVisionPlugin(): Plugin {
  let credentialPath: string
  async function handle(request: IncomingMessage, response: ServerResponse, next: () => void) {
    if (!request.url?.startsWith('/api/local-vision/'))
      return next()
    const host = request.headers.host ?? ''
    const origin = `http://${host}`
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Content-Type', 'application/json')
    // A custom header blocks cross-origin simple requests, including localhost CSRF.
    if (!['127.0.0.1:5173', '127.0.0.1:4173', 'localhost:5173', 'localhost:4173'].includes(host)
      || request.headers['x-airi-vision'] !== '1'
      || (request.headers.origin && request.headers.origin !== origin)
      || (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin')) {
      response.writeHead(403).end('{"error":"origin"}')
      return
    }
    const path = request.url.slice('/api/local-vision'.length)
    const pathname = path.split('?')[0]
    if (!/^\/(?:developer\/session|admin\/(?:overview|rules\/[\w-]+|persons(?:\/[\w-]+(?:\/memories\/[\w%.-]+)?)?)|health|metrics|persons(?:\/[\w-]+(?:\/forget)?)?|bindings(?:\/[\w-]+(?:\/(?:ticket|policy|primary|correct|find|social|conversation|enrollment(?:\/commit)?))?)?)$/.test(pathname)) {
      response.writeHead(404).end('{"error":"route"}')
      return
    }
    try {
      const chunks: Buffer[] = []
      let length = 0
      for await (const chunk of request) {
        length += chunk.length
        if (length > 8192) {
          response.writeHead(413).end('{"error":"size"}')
          return
        }
        chunks.push(Buffer.from(chunk))
      }
      const credential = (await readFile(credentialPath, 'utf8')).trim()
      const upstream = await fetch(`http://127.0.0.1:18765${path}`, {
        method: request.method,
        headers: { 'Authorization': `Bearer ${credential}`, 'Content-Type': 'application/json', 'Cookie': request.headers.cookie ?? '' },
        body: chunks.length ? Buffer.concat(chunks) : undefined,
        signal: AbortSignal.timeout(path.endsWith('/find') ? 20000 : 5000),
      })
      const cookie = upstream.headers.get('set-cookie')
      if (cookie)
        response.setHeader('Set-Cookie', cookie)
      response.writeHead(upstream.status).end(await upstream.text())
    }
    catch {
      response.writeHead(503).end('{"error":"service-unavailable"}')
    }
  }
  return {
    name: 'airi:local-vision',
    config(config) {
      const deny = config.server?.fs?.deny ?? ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**']
      return {
        server: {
          fs: { strict: true, deny: [...deny, '**/.local/**'] },
          proxy: {
            '/api/local-vision/stream': {
              target: 'http://127.0.0.1:18765',
              ws: true,
              changeOrigin: true,
              rewrite: path => path.replace(/^\/api\/local-vision/, ''),
            },
          },
        },
      }
    },
    configResolved(config) {
      credentialPath = resolve(config.root, '../../.local/vision/credential')
    },
    configureServer(server) { server.middlewares.use(handle) },
    configurePreviewServer(server) { server.middlewares.use(handle) },
  }
}
