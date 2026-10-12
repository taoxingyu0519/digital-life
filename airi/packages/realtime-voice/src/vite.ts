import type { Plugin } from 'vite'

import { resolve } from 'node:path'

import { VoiceGateway } from './gateway'

/** Adds the same local voice gateway to Vite development and build preview. */
export function realtimeVoicePlugin(): Plugin {
  let configPath: string
  let gateway: VoiceGateway | undefined
  return {
    name: 'airi:realtime-voice',
    config(config) {
      // Vite compiles this matcher before configResolved. Preserve its default exclusions.
      const deny = config.server?.fs?.deny ?? ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**']
      return { server: { fs: { strict: true, deny: [...deny, '**/.local/**'] } } }
    },
    configResolved(config) {
      configPath = resolve(config.root, '../../.local/realtime-voice.json')
    },
    configureServer(server) {
      gateway?.close()
      if (server.httpServer)
        gateway = new VoiceGateway(server.httpServer, configPath)
    },
    configurePreviewServer(server) {
      gateway?.close()
      gateway = new VoiceGateway(server.httpServer, configPath)
    },
  }
}
