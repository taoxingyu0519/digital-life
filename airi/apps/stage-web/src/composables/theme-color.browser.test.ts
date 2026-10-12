import { useThemeColor } from '@proj-airi/stage-layouts/composables/theme-color'
import { expect, it } from 'vitest'

// http://127.0.0.1:5174 — AIRI-037: a hidden stage can mount before background sampling has a color.
// ROOT CAUSE: an empty initial sample reached Color(). Keep the existing theme until a valid sample arrives.
it('aIRI-037 preserves the current theme until background sampling produces a color', async () => {
  const meta = document.createElement('meta')
  meta.name = 'theme-color'
  meta.content = '#123456'
  document.head.append(meta)
  let color = ''
  const { updateThemeColor } = useThemeColor(() => color)
  try {
    await updateThemeColor()
    expect(meta.content).toBe('#123456')
    color = 'rgb(20 40 60)'
    await updateThemeColor()
    expect(meta.content).toBe('#14283c')
  }
  finally { meta.remove() }
})
