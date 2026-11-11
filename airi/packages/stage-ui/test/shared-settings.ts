import type { SharedSettings } from '../src/services/shared-settings-contract'

import { brainPromptDefaults } from '@proj-airi/realtime-voice/prompts'

/** Generated, credential-free configuration for host and browser regression tests. */
export function sharedSettingsFixture(): SharedSettings {
  return {
    prompts: structuredClone(brainPromptDefaults),
    providers: [],
    model: { provider: '', model: '', customModel: '', temperature: 0.7, topP: 1, reasoning: false, temperatureEnabled: false, topPEnabled: false },
    conversation: { style: 'natural', delay: 5, textInput: true },
    search: { enabled: false, provider: 'firecrawl', apiKey: '', firecrawlApiKey: '' },
  }
}
