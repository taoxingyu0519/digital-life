import type { Observation, SocialState } from '@proj-airi/local-vision/contracts'
import type { Plugin } from 'vite'

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import { WebSocketServer } from 'ws'

/** A local transport fixture replaces inference while browser capture and application stores remain real. */
export function visionServiceFixture(): Plugin {
  return {
    name: 'test:local-vision-service',
    configureServer(server) {
      const sockets = new WebSocketServer({ noServer: true })
      const bindings = new Map<string, { session_binding_id: string, source_id: string, epoch: number, privacy_generation: number }>()
      const scenes = new Map<string, { actors: Observation['payload']['actors'], paused?: boolean, nameState?: SocialState['learning']['name_state'], learning?: SocialState['learning'], turns?: Array<SocialState['learning']> }>()
      let introduced = false
      server.httpServer?.on('close', () => sockets.close())
      server.httpServer?.on('upgrade', (request, socket, head) => {
        if (!request.url?.startsWith('/api/local-vision/stream'))
          return
        const binding = new URL(request.url, 'http://localhost').searchParams.get('ticket') ?? ''
        const source = bindings.get(binding)
        if (!source)
          return socket.destroy()
        sockets.handleUpgrade(request, socket, head, (connection) => {
          connection.on('message', (data) => {
            const scene = scenes.get(binding)
            if (scene?.paused)
              return
            const bytes = Buffer.from(data as ArrayBuffer)
            const header = JSON.parse(bytes.subarray(8, 8 + bytes.readUInt32BE(4)).toString()) as { seq: number }
            connection.send(JSON.stringify({
              snapshot: {
                ...source,
                schema_version: '1.0',
                event_id: randomUUID(),
                evidence_mode: 'live',
                seq: header.seq,
                observed_at_utc: new Date().toISOString(),
                valid_for_ms: 2000,
                type: 'observation.snapshot',
                payload: {
                  frame_seq: header.seq,
                  primary_track_id: scene ? scene.actors[0]?.track_id ?? null : 'visitor',
                  actors: scene?.actors ?? [{ track_id: 'visitor', bbox: [0.1, 0.1, 0.9, 0.9], face_bbox: [0.3, 0.1, 0.5, 0.3], primary: true, identity_status: introduced ? 'confirmed' : 'unknown', person_id: introduced ? 'alex' : null, display_name: introduced ? 'Alex' : null, visible_cues: [] }],
                  objects: [],
                },
              },
              actions: [],
              quality: 'clear',
              enrollment_samples: 0,
              processing_ms: 5,
              recognition: { reason: introduced ? 'confirmed' : 'below-threshold', samples: introduced ? 3 : 0, score: introduced ? 0.9 : 0.2, threshold: 0.55 },
              adaptation: { state: 'reviewing', candidates: 1, saved: 0, tracking: true },
            }))
          })
        })
      })
      server.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith('/api/local-vision/'))
          return next()
        response.setHeader('Content-Type', 'application/json')
        const path = request.url.slice('/api/local-vision'.length)
        if (path === '/test-reset' && request.method === 'POST') {
          introduced = false
          return response.end('{}')
        }
        if (path === '/health')
          return response.end(JSON.stringify({ protocol: '1.0', ready: true, error: '', device: 'cuda', calibrated: false, camera_condition: null, grounding: 'missing' }))
        if (path === '/persons')
          return response.end(JSON.stringify(introduced ? [{ person_id: 'alex', display_name: 'Alex' }] : []))
        if (path === '/bindings' && request.method === 'POST') {
          const source = { session_binding_id: randomUUID(), source_id: randomUUID(), epoch: 1, privacy_generation: 1 }
          bindings.set(source.session_binding_id, source)
          return response.end(JSON.stringify(source))
        }
        const [, binding, action] = path.split('/').slice(1)
        const source = bindings.get(binding)
        if (!source)
          return response.writeHead(409).end('{}')
        if (action === 'test-scene') {
          const chunks: Buffer[] = []
          for await (const chunk of request)
            chunks.push(Buffer.from(chunk))
          scenes.set(binding, JSON.parse(Buffer.concat(chunks).toString()))
          return response.end('{}')
        }
        if (request.method === 'DELETE') {
          scenes.delete(binding)
          bindings.delete(binding)
          return response.end('{"stopped":true}')
        }
        if (action === 'policy') {
          source.privacy_generation++
          return response.end(JSON.stringify(source))
        }
        if (action === 'ticket')
          return response.end(JSON.stringify({ ticket: binding }))
        if (action === 'conversation') {
          const scene = scenes.get(binding)
          if (scene?.turns) {
            const learning = scene.turns.shift()
            if (!learning)
              return response.writeHead(409).end('{"error":"unexpected-turn"}')
            scene.learning = learning
            return response.end(JSON.stringify({ learning }))
          }
          introduced = true
          return response.end(JSON.stringify({ learning: { name: 'Alex', person_id: 'alex', samples: 10, poses: ['front'], learning: false, awaiting_name: false, name_state: 'confirmed' } }))
        }
        if (action === 'social') {
          // A realistic local round trip crosses several capture frames during greeting preparation.
          await new Promise(resolve => setTimeout(resolve, 180))
          const scene = scenes.get(binding)
          if (scene) {
            const actor = scene.actors.length === 1 ? scene.actors[0] : undefined
            const known = actor?.identity_status === 'confirmed'
            return response.end(JSON.stringify({ learning: scene.learning ?? { name: known ? actor.display_name : '', person_id: known ? actor.person_id : null, samples: 0, poses: [], learning: false, awaiting_name: false, name_state: scene.nameState ?? 'idle' }, rules: [], recipient: known ? { person_id: actor.person_id, display_name: actor.display_name } : null, profile: known ? { person_id: actor.person_id, display_name: actor.display_name, poses: ['front'], memories: [], created_at: 1, last_seen: 2 } : null }))
          }
          return response.end(JSON.stringify({ learning: { name: '', person_id: null, samples: 0, poses: [], learning: false, awaiting_name: !introduced, name_state: 'idle' }, rules: [], recipient: introduced ? { person_id: 'alex', display_name: 'Alex' } : null, profile: introduced ? { person_id: 'alex', display_name: 'Alex', poses: ['front'], memories: [{ text: 'My name is Alex', at: 1 }], created_at: 1, last_seen: 2 } : null }))
        }
        response.writeHead(404).end('{}')
      })
    },
  }
}
