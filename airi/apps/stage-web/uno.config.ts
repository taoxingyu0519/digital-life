import { env } from 'node:process'

import { mergeConfigs, presetWebFonts } from 'unocss'

import { presetWebFontsFonts, sharedUnoConfig } from '../../uno.config'

export default mergeConfigs([
  sharedUnoConfig(),
  {
    presets: [
      presetWebFonts({
        fonts: {
          // Browser regressions keep font families without depending on an external font download.
          ...presetWebFontsFonts(env.VITEST === 'true' ? 'none' : 'fontsource'),
        },
        timeouts: {
          warning: 5000,
          failure: 10000,
        },
      }),
    ],
    rules: [
      ['transition-colors-none', {
        'transition-property': 'color, background-color, border-color, text-color',
        'transition-duration': '0s',
      }],
    ],
  },
])
