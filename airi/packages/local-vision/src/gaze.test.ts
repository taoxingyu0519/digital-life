import type { FrameResult } from './contracts'

import { parse } from 'valibot'
import { expect, it } from 'vitest'

import { frameResultSchema } from './contracts'
import { FaceGaze } from './gaze'

function frame(): FrameResult {
  return {
    snapshot: {
      schema_version: '1.0',
      evidence_mode: 'live',
      event_id: 'event',
      type: 'observation.snapshot',
      session_binding_id: 'session',
      source_id: 'camera',
      epoch: 1,
      privacy_generation: 1,
      seq: 1,
      observed_at_utc: '2026-10-01T00:00:00Z',
      valid_for_ms: 2000,
      payload: { frame_seq: 1, primary_track_id: 'visitor', objects: [], actors: [{
        track_id: 'visitor',
        bbox: [0.1, 0.1, 0.9, 0.9],
        face_bbox: [0.1, 0.2, 0.3, 0.4],
        primary: true,
        identity_status: 'unknown',
        person_id: null,
        display_name: null,
        visible_cues: [],
      }] },
    },
    actions: [],
    quality: 'recognition-only',
    enrollment_samples: 0,
    processing_ms: 10,
    recognition: null,
    adaptation: null,
  }
}

it('follows a visible stranger with mirrored direction and smooth motion instead of body-box coordinates', () => {
  const gaze = new FaceGaze()
  const value = parse(frameResultSchema, frame())
  const first = gaze.update(value, value.snapshot, 50, true, 1 / 60)!
  expect(first.x).toBeGreaterThan(0.5)
  expect(first.x).toBeLessThan(0.8)
  for (let tick = 0; tick < 300; tick++) {
    value.snapshot.seq++
    gaze.update(value, value.snapshot, 50, true, 1 / 60)
  }
  const still = gaze.update(value, value.snapshot, 50, true, 1 / 60)!
  expect(still.x).toBeCloseTo(0.8, 1)
  expect(still.y).toBeCloseTo(0.3, 1)
  value.snapshot.payload.actors[0].face_bbox = [0.7, 0.6, 0.9, 0.8]
  const moving = gaze.update(value, value.snapshot, 50, true, 1 / 60)!
  expect(moving.x).toBeLessThan(still.x)
  expect(moving.x).toBeGreaterThan(0.2)
  expect(moving.y).toBeGreaterThan(still.y)
})

it('holds a brief detector miss and releases prolonged loss, stale frames and disabled camera permission', () => {
  const gaze = new FaceGaze()
  const value = frame()
  const source = { ...value.snapshot }
  expect(gaze.update(value, source, 50, true, 0.1)).toBeDefined()
  value.snapshot.payload.actors[0].face_bbox = null
  expect(gaze.update(value, source, 50, true, 0.1)).toBeDefined()
  expect(gaze.update(value, source, 50, true, 0.1)).toBeDefined()
  expect(gaze.update(value, source, 50, true, 0.1)).toBeUndefined()
  value.snapshot.payload.actors[0].face_bbox = [0.1, 0.2, 0.3, 0.4]
  expect(gaze.update(value, source, 50, true, 0.1)).toBeDefined()
  expect(gaze.update(value, source, 1501, true, 0.1)).toBeUndefined()
  expect(gaze.update(value, source, 50, true, 0.1)).toBeDefined()
  expect(gaze.update(value, source, 50, false, 0.1)).toBeUndefined()
  expect(gaze.update(value, { ...source, epoch: 2 }, 50, true, 0.1)).toBeUndefined()
})

// http://127.0.0.1:5174 — AIRI-044: the 500-ms gaze expiry resets halfway between one-Hz frames.
// ROOT CAUSE: gaze freshness assumed high-rate inference. Keep the target for a bounded 1500 ms, within the observation lease.
it('aIRI-044 keeps gaze between one-Hz frames and respects a shorter observation lease', () => {
  const gaze = new FaceGaze()
  const value = frame()
  expect(gaze.update(value, value.snapshot, 50, true, 0.1)).toBeDefined()
  expect(gaze.update(value, value.snapshot, 1200, true, 0.1)).toBeDefined()
  expect(gaze.update(value, value.snapshot, 1501, true, 0.1)).toBeUndefined()
  value.snapshot.valid_for_ms = 700
  expect(gaze.update(value, value.snapshot, 50, true, 0.1)).toBeDefined()
  expect(gaze.update(value, value.snapshot, 701, true, 0.1)).toBeUndefined()
})

it('keeps one tracked face when another enters and respects an explicit primary target', () => {
  const gaze = new FaceGaze()
  const value = frame()
  value.snapshot.payload.primary_track_id = null
  const visitor = value.snapshot.payload.actors[0]
  visitor.primary = false
  for (let tick = 0; tick < 60; tick++)
    gaze.update(value, value.snapshot, 50, true, 1 / 60)
  const other = { ...visitor, track_id: 'other', face_bbox: [0.6, 0.1, 1, 0.5] as [number, number, number, number] }
  value.snapshot.payload.actors.push(other)
  const kept = gaze.update(value, value.snapshot, 50, true, 1 / 60)!
  expect(kept.x).toBeGreaterThan(0.75)
  other.primary = true
  value.snapshot.payload.primary_track_id = other.track_id
  const selected = gaze.update(value, value.snapshot, 50, true, 1 / 60)!
  expect(selected.x).toBeLessThan(kept.x)
})

it('rejects malformed face positions and accepts an explicitly absent face', () => {
  const value = frame()
  value.snapshot.payload.actors[0].face_bbox = [0, 0, 1.1, 1]
  expect(() => parse(frameResultSchema, value)).toThrow()
  value.snapshot.payload.actors[0].face_bbox = null
  expect(parse(frameResultSchema, value).snapshot.payload.actors[0].face_bbox).toBeNull()
})

it('resets smoothing when a capture generation changes on the same source object', () => {
  const gaze = new FaceGaze()
  const value = frame()
  const source = { session_binding_id: 'session', source_id: 'camera', epoch: 1, privacy_generation: 1 }
  for (let tick = 0; tick < 100; tick++)
    gaze.update(value, source, 50, true, 1 / 60)
  source.epoch++
  value.snapshot.epoch++
  value.snapshot.payload.actors[0].face_bbox = [0.4, 0.4, 0.6, 0.6]
  const current = gaze.update(value, source, 50, true, 1 / 60)!
  expect(current.x).toBe(0.5)
  expect(current.y).toBe(0.5)
})
