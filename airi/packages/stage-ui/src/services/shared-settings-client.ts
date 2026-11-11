import type { SharedSettings, SharedSettingsSnapshot } from './shared-settings-contract'

import * as v from 'valibot'

import { sharedSettingsSnapshotSchema } from './shared-settings-contract'

export type SharedSettingsState = 'loading' | 'empty' | 'synced' | 'pending' | 'offline' | 'conflict' | 'follower'
export interface SharedSettingsCheckpoint { revision: number, baseline: SharedSettings | null, pending: boolean }
interface SettingsBoundary {
  read: () => SharedSettings
  apply: (settings: SharedSettings) => Promise<void>
  meaningful: (settings: SharedSettings) => boolean
  backup: (settings: SharedSettings) => void
  checkpoint: (value: SharedSettingsCheckpoint) => void
  status: (state: SharedSettingsState, revision: number, conflicting: boolean) => void
}

/** One elected renderer owns host IO. Durable checkpoints preserve offline edits across reloads. */
export class SharedSettingsClient {
  private generation = 0
  private active = false
  private applying = false
  private busy = false
  private conflict?: SharedSettingsSnapshot
  private interval?: ReturnType<typeof setInterval>
  private debounce?: ReturnType<typeof setTimeout>
  private checkpoint: SharedSettingsCheckpoint

  constructor(private boundary: SettingsBoundary, checkpoint?: SharedSettingsCheckpoint) {
    this.checkpoint = checkpoint ?? { revision: 0, baseline: null, pending: false }
  }

  private signature(value: SharedSettings | null) { return JSON.stringify(value) }
  private changed() { return this.signature(this.boundary.read()) !== this.signature(this.checkpoint.baseline) }
  private report(state: SharedSettingsState) { this.boundary.status(state, this.checkpoint.revision, !!this.conflict) }
  private persist() { this.boundary.checkpoint(structuredClone(this.checkpoint)) }

  async start() {
    this.stop()
    this.active = true
    this.report('loading')
    await this.refresh()
    if (this.active)
      this.interval = setInterval(() => { void this.refresh() }, 5000)
  }

  stop() {
    this.active = false
    this.generation++
    clearInterval(this.interval)
    clearTimeout(this.debounce)
  }

  edited() {
    if (!this.active || this.applying)
      return
    this.checkpoint.pending = this.changed()
    this.persist()
    if (this.conflict)
      return
    this.report('pending')
    clearTimeout(this.debounce)
    this.debounce = setTimeout(() => {
      void this.refresh()
    }, 750)
  }

  private async accept(snapshot: SharedSettingsSnapshot) {
    if (!snapshot.settings) {
      this.report('empty')
      return
    }
    if (this.signature(this.boundary.read()) !== this.signature(snapshot.settings)) {
      if (this.boundary.meaningful(this.boundary.read()))
        this.boundary.backup(this.boundary.read())
      this.applying = true
      try {
        await this.boundary.apply(snapshot.settings)
      }
      finally { this.applying = false }
    }
    this.checkpoint = { revision: snapshot.revision, baseline: snapshot.settings, pending: false }
    this.persist()
    this.conflict = undefined
    this.report('synced')
  }

  private async request(method: 'GET' | 'PUT', body?: unknown) {
    const response = await fetch('/api/shared-settings', {
      method,
      headers: { 'x-airi-settings': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(method === 'PUT' ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    })
    if (!response.ok && response.status !== 409)
      throw new Error('shared-settings-unavailable')
    return { conflict: response.status === 409, snapshot: v.parse(sharedSettingsSnapshotSchema, await response.json()) }
  }

  async refresh() {
    if (!this.active || this.busy || this.conflict)
      return
    this.busy = true
    const generation = this.generation
    try {
      const local = this.boundary.read()
      const pending = this.checkpoint.pending || (!!this.checkpoint.baseline && this.changed())
      if (pending || (!this.checkpoint.baseline && this.boundary.meaningful(local))) {
        // Revision zero also uses CAS: a late first device cannot replace an already-seeded host.
        const result = await this.request('PUT', { revision: this.checkpoint.revision, settings: local })
        if (generation !== this.generation)
          return
        if (result.conflict) {
          this.conflict = result.snapshot
          this.checkpoint.pending = true
          this.persist()
          this.report('conflict')
        }
        else {
          // Edits made during the request stay pending instead of being reverted by its receipt.
          this.checkpoint = { revision: result.snapshot.revision, baseline: result.snapshot.settings, pending: this.signature(local) !== this.signature(this.boundary.read()) }
          this.persist()
          this.report(this.checkpoint.pending ? 'pending' : 'synced')
        }
      }
      else {
        const result = await this.request('GET')
        if (generation !== this.generation)
          return
        if (this.signature(local) !== this.signature(this.boundary.read())) {
          this.checkpoint.pending = true
          this.persist()
          return
        }
        await this.accept(result.snapshot)
      }
    }
    catch {
      if (generation === this.generation)
        this.report('offline')
    }
    finally { this.busy = false }
  }

  /** User resolution backs up the draft, then fetches the latest host revision. */
  async useHost() {
    if (!this.active || this.busy)
      return
    const generation = this.generation
    this.busy = true
    try {
      const result = await this.request('GET')
      if (generation === this.generation)
        await this.accept(result.snapshot)
    }
    catch { this.report('offline') }
    finally { this.busy = false }
  }

  async useLocal() {
    if (!this.active || this.busy)
      return
    const generation = this.generation
    this.busy = true
    try {
      const result = await this.request('GET')
      if (generation !== this.generation)
        return
      this.checkpoint.revision = result.snapshot.revision
      this.checkpoint.pending = true
      this.conflict = undefined
      this.persist()
    }
    catch {
      this.report('offline')
      return
    }
    finally { this.busy = false }
    await this.refresh()
  }
}
