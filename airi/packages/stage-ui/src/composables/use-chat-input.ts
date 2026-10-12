import type { ChatSendPayload } from '../stores/chat'

import { useI18n } from 'vue-i18n'

import { useChatStore } from '../stores/chat'
import { useConsciousnessStore } from '../stores/modules/consciousness'
import { useRealtimeVoiceStore } from '../stores/modules/realtime-voice'
import { useStageRuntimeStore } from '../stores/stage-runtime'

/** Typed requests use the configured worker. Images retain the ordinary image-capable chat path. */
export function useChatInput() {
  const chat = useChatStore()
  const voice = useRealtimeVoiceStore()
  const consciousness = useConsciousnessStore()
  const { t } = useI18n()

  async function send(payload: ChatSendPayload) {
    if (!useStageRuntimeStore().enabled)
      throw new Error(t('stage.runtime.sleeping-input'))
    voice.errorCode = ''
    const textConfigured = !!consciousness.activeProvider && (!!consciousness.activeModel || consciousness.activeProvider === 'prompt-api')
    if (!voice.active && !voice.configured && !textConfigured)
      await voice.refreshConfig()
    const fastInput = voice.active || (voice.useForText && textConfigured)
    if (!textConfigured) {
      voice.errorCode = payload.attachments?.length ? 'text-attachments' : 'text-provider'
      throw new Error(t(`settings.realtime.errors.${voice.errorCode}`))
    }
    if (fastInput && !payload.attachments?.length) {
      try {
        await voice.sendText(payload.text, payload.sessionId)
        return
      }
      catch (error) {
        if (!voice.errorCode)
          voice.errorCode = 'text-input'
        throw error
      }
    }
    if (voice.active)
      voice.stop()
    return chat.send(payload)
  }

  return { send }
}
