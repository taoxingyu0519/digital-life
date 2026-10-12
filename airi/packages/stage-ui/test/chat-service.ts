import type { Plugin } from 'vite'

import { WebSocketServer } from 'ws'

/** Exercises connection ownership with native browser sockets. It never connects to the hosted service. */
export function chatServiceFixture(): Plugin {
  return {
    name: 'test:chat-service',
    configureServer(server) {
      const sockets = new WebSocketServer({ noServer: true })
      let opened = 0
      server.httpServer?.on('close', () => sockets.close())
      server.httpServer?.on('upgrade', (request, socket, head) => {
        if (!request.url?.startsWith('/ws/v2/chat'))
          return
        sockets.handleUpgrade(request, socket, head, () => {
          opened++
        })
      })
      server.middlewares.use((request, response, next) => {
        if (request.url !== '/api/test-chat/connections')
          return next()
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ opened, active: sockets.clients.size }))
      })
    },
  }
}
