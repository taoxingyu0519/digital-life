import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { createServer } from 'vite'
import { expect, it } from 'vitest'

import { realtimeVoicePlugin } from './vite'

it('blocks direct and raw HTTP reads of local credentials while serving allowed files', async () => {
  // Vite's Windows raw-file middleware serves from the current drive.
  const directory = await mkdtemp(join(import.meta.dirname, 'airi-voice-vite-'))
  if (dirname(directory) !== import.meta.dirname || !directory.includes('airi-voice-vite-'))
    throw new Error('Invalid temporary test directory')
  const root = join(directory, 'apps/web')
  await mkdir(root, { recursive: true })
  await mkdir(join(directory, '.local'))
  await writeFile(join(directory, '.local/realtime-voice.json'), '{"apiKey":"test-only-secret"}')
  await writeFile(join(directory, 'allowed.txt'), 'public')
  const server = await createServer({
    configFile: false,
    root,
    plugins: [realtimeVoicePlugin()],
    server: { host: '127.0.0.1', port: 0, fs: { allow: [directory] } },
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: [] },
  })
  try {
    await server.listen()
    const base = server.resolvedUrls?.local[0]
    expect(base).toBeDefined()
    const fileUrl = (path: string) => new URL(`/@fs/${path.replaceAll('\\', '/')}`, base)
    const allowed = await fetch(fileUrl(join(directory, 'allowed.txt')))
    expect(allowed.status, allowed.url).toBe(200)
    expect(await allowed.text()).toBe('public')
    for (const suffix of ['', '?raw', '?import']) {
      const response = await fetch(`${fileUrl(join(directory, '.local/realtime-voice.json'))}${suffix}`)
      expect(response.status).toBe(403)
      expect(await response.text()).not.toContain('test-only-secret')
    }
  }
  finally {
    await server.close()
    await rm(directory, { recursive: true, force: true })
  }
})
