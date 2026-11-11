import { createRequire } from 'node:module'

// Read-only delivery probes use the configured local gateway; no camera, history or paid completion is sent.
const require = createRequire(new URL('../airi/packages/realtime-voice/package.json', import.meta.url))
const { WebSocket } = require('ws')
const origin = process.env.AIRI_WEB_ORIGIN ?? 'http://127.0.0.1:5173'
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))
  throw new Error('AIRI_WEB_ORIGIN must point to the local AIRI web port')
const checks = []
async function check(name, probe) {
  try {
    const detail = await probe()
    checks.push({ name, passed: true, ...detail })
  }
  catch {
    checks.push({ name, passed: false })
  }
}

await check('网页入口', async () => {
  const response = await fetch(origin, { signal: AbortSignal.timeout(5000) })
  if (!response.ok || !(await response.text()).includes('<title>AIRI</title>'))
    throw new Error('web')
})
await check('当前启停网关及同源保护', async () => {
  const response = await fetch(`${origin}/api/stage-runtime/wake`, { method: 'POST', signal: AbortSignal.timeout(5000) })
  if (response.status !== 403 || (await response.json()).error !== 'origin')
    throw new Error('stale-runtime')
  const malformed = await fetch(`${origin}/api/stage-runtime/unknown`, { method: 'POST', headers: { 'x-airi-runtime': '1', Origin: origin }, signal: AbortSignal.timeout(5000) })
  if (malformed.status !== 400 || (await malformed.json()).error !== 'request')
    throw new Error('route')
})
await check('真实视觉服务', async () => {
  const response = await fetch(`${origin}/api/local-vision/health`, { headers: { 'x-airi-vision': '1', Origin: origin }, signal: AbortSignal.timeout(6000) })
  const health = await response.json()
  if (!response.ok || !health.ready)
    throw new Error('models')
  return { ready: true, device: health.device }
})
await check('当前共享配置网关及同源保护', async () => {
  const response = await fetch(`${origin}/api/shared-settings`, { headers: { 'x-airi-settings': '1', Origin: origin }, signal: AbortSignal.timeout(12000) })
  const snapshot = await response.json()
  if (!response.ok || !Number.isSafeInteger(snapshot.revision) || !('settings' in snapshot))
    throw new Error('shared-settings')
  const denied = await fetch(`${origin}/api/shared-settings`, { signal: AbortSignal.timeout(5000) })
  if (denied.status !== 403)
    throw new Error('origin')
  return { revision: snapshot.revision, hasSharedCopy: snapshot.settings !== null }
})
await check('真实语音网关配置连接', () => new Promise((resolve, reject) => {
  const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/api/realtime-voice`, { origin })
  const timeout = setTimeout(() => { socket.close(); reject(new Error('timeout')) }, 10000)
  socket.on('open', () => socket.send(JSON.stringify({ type: 'config:get', id: 'delivery-config' })))
  socket.on('message', (bytes) => {
    try {
      const event = JSON.parse(bytes.toString())
      if (event.type === 'config' && event.id === 'delivery-config') {
        clearTimeout(timeout)
        socket.close()
        resolve({ configured: !!event.config.configured, modelAuthenticationTested: false })
      }
      else if (event.type === 'error') {
        clearTimeout(timeout)
        socket.close()
        reject(new Error('gateway'))
      }
    }
    catch { reject(new Error('protocol')) }
  })
  socket.on('error', () => { clearTimeout(timeout); reject(new Error('connection')) })
}))
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), passed: checks.every(check => check.passed), checks }, null, 2))
process.exitCode = checks.every(check => check.passed) ? 0 : 1
