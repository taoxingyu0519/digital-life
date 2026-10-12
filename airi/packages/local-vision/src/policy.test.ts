import type { FrameResult, VisionPermissions } from './contracts'

import { parse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { frameResultSchema } from './contracts'
import { projectObservation, SocialScheduler } from './policy'

const permissions: VisionPermissions = { observations: true, names: false, face: true, images: false, greetings: true }

function frame(): FrameResult {
  return {
    snapshot: {
      schema_version: '1.0',
      event_id: 'event',
      evidence_mode: 'live',
      session_binding_id: 'binding',
      source_id: 'camera',
      epoch: 1,
      privacy_generation: 1,
      seq: 1,
      observed_at_utc: '2026-09-29T00:00:00Z',
      valid_for_ms: 2000,
      type: 'observation.snapshot',
      payload: { frame_seq: 1, primary_track_id: 'track', objects: [], actors: [{
        track_id: 'track',
        bbox: [0.1, 0.1, 0.8, 0.8],
        face_bbox: [0.3, 0.1, 0.5, 0.3],
        primary: true,
        identity_status: 'confirmed',
        person_id: 'private-id',
        display_name: 'PRIVATE NAME',
        visible_cues: ['hand_visible'],
      }] },
    },
    actions: [{ action: 'wave', track_id: 'track' }],
    quality: 'accepted',
    enrollment_samples: 0,
    processing_ms: 30,
    recognition: null,
    adaptation: null,
  }
}

describe('current-request vision privacy', () => {
  it('projects observations without internal identifiers, names or images', () => {
    const result = frame()
    result.recognition = { reason: 'confirmed', samples: 3, score: 0.77, threshold: 0.55 }
    result.adaptation = { state: 'reviewing', candidates: 1, saved: 0, tracking: true }
    const text = projectObservation(result, result.snapshot, permissions, 100)
    expect(text).toContain('wave')
    expect(text).not.toContain('PRIVATE NAME')
    expect(text).not.toContain('private-id')
    expect(text).not.toContain('data:')
    expect(text).not.toContain('"recognition"')
    expect(text).not.toContain('"adaptation"')
    expect(text).not.toContain('"score"')
    expect(text).not.toContain('"threshold"')
  })

  it('checks name permission on every request', () => {
    const result = frame()
    expect(projectObservation(result, result.snapshot, { ...permissions, names: true }, 100)).toContain('PRIVATE NAME')
    expect(projectObservation(result, result.snapshot, permissions, 100)).not.toContain('PRIVATE NAME')
    expect(projectObservation(result, result.snapshot, { ...permissions, observations: false, names: true }, 100)).toBe('')
  })

  it('rejects expired, missing and cross-generation evidence', () => {
    const result = frame()
    expect(projectObservation(result, result.snapshot, permissions, 2001)).toBe('')
    expect(projectObservation(result, undefined, permissions, 10)).toBe('')
    expect(projectObservation(result, { ...result.snapshot, epoch: 2 }, permissions, 10)).toBe('')
    expect(projectObservation(result, { ...result.snapshot, privacy_generation: 2 }, permissions, 10)).toBe('')
    expect(projectObservation(result, { ...result.snapshot, session_binding_id: 'other' }, permissions, 10)).toBe('')
  })

  it('rejects names on uncertain identities, unknown fields and invalid geometry', () => {
    const result = frame()
    result.snapshot.payload.actors[0].identity_status = 'ambiguous'
    expect(() => parse(frameResultSchema, result)).toThrow()
    expect(() => parse(frameResultSchema, { ...frame(), image: 'data:secret' })).toThrow()
    const geometry = frame()
    geometry.snapshot.payload.actors[0].bbox = [0.8, 0.1, 0.2, 0.7]
    expect(() => parse(frameResultSchema, geometry)).toThrow()
  })

  it('rejects a primary actor absent from the snapshot and non-live evidence', () => {
    const result = frame()
    result.snapshot.payload.primary_track_id = 'missing'
    expect(() => parse(frameResultSchema, result)).toThrow()
    expect(() => parse(frameResultSchema, { ...frame(), snapshot: { ...frame().snapshot, evidence_mode: 'mock' } })).toThrow()
  })
})

describe('proactive greetings', () => {
  it('waits for stable entry and never consumes cooldown for cancelled candidates', () => {
    const scheduler = new SocialScheduler()
    expect(scheduler.candidate(frame(), 0, false)).toBeUndefined()
    expect(scheduler.candidate(frame(), 900, true)).toBeUndefined()
    expect(scheduler.candidate(frame(), 1300, false)?.key).toBe('private-id')
    expect(scheduler.candidate(frame(), 1400, false)?.key).toBe('private-id')
    scheduler.commit('private-id', 1400)
    expect(scheduler.candidate(frame(), 1500, false)).toBeUndefined()
  })

  it('greets a person who remains present after a busy conversation', () => {
    const scheduler = new SocialScheduler()
    scheduler.candidate(frame(), 0, true)
    expect(scheduler.candidate(frame(), 5100, false)?.kind).toBe('greeting')
  })

  it('does not greet again after a short disappearance', () => {
    const scheduler = new SocialScheduler()
    scheduler.candidate(frame(), 0, false)
    scheduler.commit('private-id', 1000)
    const empty = frame()
    empty.snapshot.payload.actors = []
    empty.snapshot.payload.primary_track_id = null
    scheduler.candidate(empty, 2000, false)
    expect(scheduler.candidate(frame(), 4000, false)).toBeUndefined()
  })

  it('retains the global cooldown through a source reset', () => {
    const scheduler = new SocialScheduler()
    scheduler.commit('private-id', 1000)
    scheduler.reset()
    scheduler.candidate(frame(), 3000, false)
    expect(scheduler.candidate(frame(), 4000, false)).toBeUndefined()
  })

  it('starts memory-aware small talk after the interval, and postpones it for real input', () => {
    const scheduler = new SocialScheduler()
    scheduler.candidate(frame(), 0, false)
    scheduler.commit('private-id', 1400)
    for (let at = 5000; at < 301500; at += 5000)
      scheduler.candidate(frame(), at, false)
    expect(scheduler.candidate(frame(), 301500, false)?.kind).toBe('chat')
    scheduler.touch(302000)
    expect(scheduler.candidate(frame(), 310000, false)).toBeUndefined()
    for (let at = 315000; at < 363000; at += 5000)
      scheduler.candidate(frame(), at, true)
    expect(scheduler.candidate(frame(), 363000, true)).toBeUndefined()
    expect(scheduler.candidate(frame(), 363000, false)?.kind).toBe('chat')
  })

  it('does not attach small talk to an unknown replacement track', () => {
    const scheduler = new SocialScheduler()
    scheduler.candidate(frame(), 0, false)
    scheduler.commit('private-id', 1400)
    const replacement = frame()
    replacement.snapshot.payload.actors[0] = { ...replacement.snapshot.payload.actors[0], track_id: 'new', identity_status: 'unknown', person_id: null, display_name: null }
    replacement.snapshot.payload.primary_track_id = 'new'
    expect(scheduler.candidate(replacement, 301500, false)).toBeUndefined()
    expect(scheduler.candidate(replacement, 303000, false)?.name).toBeNull()
    scheduler.commit('anonymous', 303000)
    expect(scheduler.candidate(replacement, 700000, false)).toBeUndefined()
  })
})
