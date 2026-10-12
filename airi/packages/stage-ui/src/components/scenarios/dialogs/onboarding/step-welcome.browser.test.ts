import en from '@proj-airi/i18n/locales/en'

import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import StepWelcome from './step-welcome.vue'

import { useAuthStore } from '../../../../stores/auth'

afterEach(() => vi.unstubAllEnvs())

/** Creates the production English localization surface used by onboarding stores. */
function createTestI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    messages: {
      en,
    },
  })
}

/** Renders the welcome step with real Pinia and i18n plugins. */
async function renderWelcomeStep(customProviderSetupEnabled: boolean) {
  return render(StepWelcome, {
    props: {
      customProviderSetupEnabled,
      onNext: vi.fn(),
      onSkip: vi.fn(),
    },
    global: {
      directives: {
        motion: {},
      },
      plugins: [createPinia(), createTestI18n()],
    },
  })
}

/**
 * @example
 * describe('Steam onboarding provider restrictions', () => {})
 */
describe('steam onboarding provider restrictions', () => {
  /**
   * @example
   * it('keeps login without custom provider setup in Steam builds', async () => {})
   */
  it('keeps guest entry without custom provider setup in Steam builds', async () => {
    // ROOT CAUSE:
    //
    // The welcome step rendered its local-provider action without consulting
    // the distribution restriction already used by settings and provider stores.
    // A clean Steam install therefore exposed BYOK during onboarding even though
    // the same provider paths were hidden after setup.
    await renderWelcomeStep(false)

    expect(document.body.textContent).toContain('Continue as Stranger')
    expect(document.body.textContent).not.toContain('Sign in')
    expect(document.body.textContent).not.toContain('Setup with your provider')
  })

  /**
   * @example
   * it('keeps custom provider setup in direct builds', async () => {})
   */
  it('keeps custom provider setup in direct builds', async () => {
    await renderWelcomeStep(true)

    expect(document.body.textContent).toContain('Setup with your provider')
  })
})

describe('guest onboarding', () => {
  it('continues without requesting authentication or creating a session', async () => {
    vi.stubEnv('RUNTIME_ENVIRONMENT', 'electron')
    const pinia = createPinia()
    const onSkip = vi.fn()
    const screen = await render(StepWelcome, {
      props: {
        customProviderSetupEnabled: true,
        onNext: vi.fn(),
        onSkip,
      },
      global: {
        directives: { motion: {} },
        plugins: [pinia, createTestI18n()],
      },
    })

    await screen.getByRole('button', { name: 'Continue as Stranger' }).click()

    expect(onSkip).toHaveBeenCalledOnce()
    expect(useAuthStore(pinia).needsLogin).toBe(false)
    expect(useAuthStore(pinia).isAuthenticated).toBe(false)
  })
})
