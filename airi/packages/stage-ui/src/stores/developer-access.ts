import { defineStore } from 'pinia'
import { boolean, number, object, parse } from 'valibot'
import { onScopeDispose, ref } from 'vue'

const sessionSchema = object({ authenticated: boolean(), expires_at: number() })

/** The server owns access. This unsynced store only controls the current window's maintenance views. */
export const useDeveloperAccessStore = defineStore('developer-access', () => {
  const authenticated = ref(false)
  const ready = ref(false)
  let revision = 0
  let expiry: ReturnType<typeof setTimeout> | undefined

  function clear() {
    revision++
    authenticated.value = false
    clearTimeout(expiry)
  }

  async function request(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<unknown> {
    const response = await fetch(`/api/local-vision${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Airi-Vision': '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403)
        clear()
      throw new Error(`developer-${response.status}`)
    }
    return response.json()
  }

  async function refresh() {
    const current = revision
    try {
      const session = parse(sessionSchema, await request('/developer/session'))
      if (current !== revision)
        return
      authenticated.value = session.authenticated
      clearTimeout(expiry)
      if (session.authenticated)
        expiry = setTimeout(clear, Math.max(0, session.expires_at * 1000 - Date.now()))
    }
    finally { ready.value = true }
  }

  async function login(username: string, password: string) {
    clear()
    await request('/developer/session', { username, password })
    await refresh()
  }

  async function logout() {
    clear()
    await request('/developer/session', undefined, 'DELETE')
  }

  onScopeDispose(clear)
  return { authenticated, ready, refresh, login, logout, request }
})
