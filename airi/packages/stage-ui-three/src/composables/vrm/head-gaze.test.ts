import { Euler, Object3D, Quaternion } from 'three'
import { expect, it } from 'vitest'

import { HeadGaze } from './head-gaze'

it('turns a real head toward the target without accumulating rotation over consecutive frames', () => {
  const head = new Object3D()
  const gaze = new HeadGaze()
  const base = new Quaternion().setFromEuler(new Euler(0.05, -0.08, 0.02))
  head.quaternion.copy(base)
  for (let frame = 0; frame < 600; frame++) {
    gaze.restore()
    gaze.apply(head, { x: 1, y: 0 }, 1 / 60)
  }
  const expected = base.clone().multiply(new Quaternion().setFromEuler(new Euler(0.2, 0.3, 0, 'YXZ')))
  expect(head.quaternion.angleTo(expected)).toBeLessThan(0.001)
  gaze.restore()
  expect(head.quaternion.angleTo(base)).toBeLessThan(0.001)
})

it('preserves animation changes and returns smoothly when camera attention is released', () => {
  const head = new Object3D()
  const gaze = new HeadGaze()
  const animation = new Quaternion().setFromEuler(new Euler(0, 0, 0.2))
  for (let frame = 0; frame < 60; frame++) {
    gaze.restore()
    head.quaternion.copy(animation)
    gaze.apply(head, { x: 0.1, y: 0.8 }, 1 / 60)
  }
  const turned = head.quaternion.clone()
  gaze.restore()
  gaze.apply(head, undefined, 1 / 60)
  expect(head.quaternion.angleTo(animation)).toBeLessThan(turned.angleTo(animation))
  for (let frame = 0; frame < 180; frame++) {
    gaze.restore()
    gaze.apply(head, undefined, 1 / 60)
  }
  expect(head.quaternion.angleTo(animation)).toBeLessThan(0.001)
  gaze.restore()
  gaze.apply(undefined, undefined, 1 / 60)
  const replacement = new Object3D()
  gaze.apply(replacement, { x: 0.5, y: 0.5 }, 1 / 60)
  expect(replacement.quaternion.angleTo(new Quaternion())).toBe(0)
})
