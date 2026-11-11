import type { InferOutput } from 'valibot'

import { array, boolean, check, finite, integer, literal, maxLength, maxValue, minLength, minValue, nullable, number, object, picklist, pipe, strictObject, string, tuple } from 'valibot'

const id = pipe(string(), minLength(1), maxLength(200))
const natural = pipe(number(), integer(), minValue(0))
const scalar = pipe(number(), finite(), minValue(0), maxValue(1))
const box = pipe(tuple([scalar, scalar, scalar, scalar]), check(value => value[0] < value[2] && value[1] < value[3]))

export const sourceSchema = object({
  session_binding_id: id,
  source_id: id,
  epoch: natural,
  privacy_generation: natural,
})
export type VisionSource = InferOutput<typeof sourceSchema>

export const healthSchema = strictObject({
  protocol: literal('1.0'),
  ready: boolean(),
  error: string(),
  device: picklist(['cuda', 'cpu', 'unavailable']),
  calibrated: boolean(),
  camera_condition: nullable(id),
  grounding: picklist(['ready', 'missing']),
})
export type VisionHealth = InferOutput<typeof healthSchema>

const actorSchema = pipe(strictObject({
  track_id: id,
  bbox: box,
  /** Current face location in the unmirrored camera frame. Renderers use it without requiring a known name. */
  face_bbox: nullable(box),
  primary: boolean(),
  identity_status: picklist(['unavailable', 'unknown', 'candidate', 'confirmed', 'ambiguous', 'revoked']),
  person_id: nullable(id),
  display_name: nullable(pipe(string(), maxLength(64))),
  visible_cues: pipe(array(picklist(['head_facing_camera', 'hand_visible', 'mouth_corner_raised'])), maxLength(8)),
}), check(actor => actor.identity_status === 'confirmed'
  ? !!actor.person_id && actor.display_name !== null
  : actor.person_id === null && actor.display_name === null))

export const observationSchema = strictObject({
  schema_version: literal('1.0'),
  event_id: id,
  evidence_mode: literal('live'),
  ...sourceSchema.entries,
  seq: natural,
  observed_at_utc: string(),
  valid_for_ms: pipe(number(), minValue(1), maxValue(2000)),
  type: literal('observation.snapshot'),
  payload: pipe(strictObject({
    frame_seq: natural,
    primary_track_id: nullable(id),
    actors: pipe(array(actorSchema), maxLength(3)),
    objects: pipe(array(strictObject({ label: pipe(string(), maxLength(60)), score: scalar, bbox: box })), maxLength(20)),
  }), check(value => value.primary_track_id === null || value.actors.some(actor => actor.track_id === value.primary_track_id))),
})
export type Observation = InferOutput<typeof observationSchema>

export const frameResultSchema = strictObject({
  snapshot: observationSchema,
  actions: pipe(array(strictObject({ action: picklist(['nod', 'shake', 'wave', 'thumbs_up']), track_id: id })), maxLength(12)),
  quality: string(),
  enrollment_samples: natural,
  processing_ms: pipe(number(), finite(), minValue(0)),
  /** Local diagnostic evidence for the primary face. Excluded from model context and history. */
  recognition: nullable(strictObject({
    reason: picklist(['confirmed', 'collecting', 'below-threshold', 'ambiguous', 'no-templates']),
    samples: pipe(natural, maxValue(3)),
    score: nullable(pipe(number(), finite(), minValue(-1), maxValue(1))),
    threshold: scalar,
  })),
  /** Reviewed trajectory progress. Tracking alone never grants names or personal memory. */
  adaptation: nullable(strictObject({
    state: picklist(['idle', 'lost', 'ambiguous', 'discontinuous', 'expired', 'quality-rejected', 'waiting-anchor', 'conflict', 'learned', 'duplicate', 'collecting', 'stabilizing', 'reviewing']),
    candidates: pipe(natural, maxValue(3)),
    saved: pipe(natural, maxValue(3)),
    tracking: boolean(),
  })),
})
export type FrameResult = InferOutput<typeof frameResultSchema>

const personSchema = strictObject({ person_id: id, display_name: pipe(string(), maxLength(64)) })
export const personsSchema = array(personSchema)
export type VisionPerson = InferOutput<typeof personsSchema>[number]

export const learningSchema = strictObject({
  name: pipe(string(), maxLength(64)),
  person_id: nullable(id),
  samples: natural,
  poses: array(picklist(['front', 'left', 'right'])),
  learning: boolean(),
  awaiting_name: boolean(),
  name_state: picklist(['idle', 'confirming', 'correcting', 'confirmed']),
})
export const socialSchema = strictObject({
  recipient: nullable(personSchema),
  learning: learningSchema,
  rules: array(strictObject({ id, text: pipe(string(), maxLength(2000)), updated_at: number() })),
  profile: nullable(strictObject({
    person_id: id,
    display_name: pipe(string(), maxLength(64)),
    poses: array(picklist(['front', 'left', 'right'])),
    memories: pipe(array(strictObject({ text: pipe(string(), maxLength(2000)), at: number() })), maxLength(8)),
    created_at: number(),
    last_seen: number(),
  })),
})
export type SocialState = InferOutput<typeof socialSchema>

export interface VisionPermissions {
  observations: boolean
  names: boolean
  images: boolean
  face: boolean
  greetings: boolean
}

export function sameSource(left: VisionSource, right: VisionSource) {
  return left.session_binding_id === right.session_binding_id && left.source_id === right.source_id
    && left.epoch === right.epoch && left.privacy_generation === right.privacy_generation
}
