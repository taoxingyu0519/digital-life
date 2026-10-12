import { FaceGaze } from '@proj-airi/local-vision/gaze'
import { useRafFn } from '@vueuse/core'
import { shallowRef } from 'vue'

import { useLocalVisionStore } from '../../stores/local-vision'

/** Consume only the capture owner's fresh, permitted local observation. The Vue scope owns the render timer. */
export function useFaceGaze() {
  const vision = useLocalVisionStore()
  const gaze = new FaceGaze()
  const position = shallowRef<{ x: number, y: number }>()
  useRafFn(({ delta }) => {
    position.value = gaze.update(vision.result, vision.source, Date.now() - vision.lastFrameAt + vision.roundTripMs, vision.mode === 'active' && vision.owner && vision.active && vision.permissions.face && vision.permissions.observations, delta / 1000)
  })
  return position
}
