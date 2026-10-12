import { defineEventa } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/broadcast-channel'

/** Only invalidation crosses windows. Each reader rechecks its own scope against persisted records. */
export const archiveChangedEvent = defineEventa<void>('stage:chat-archive:changed')

export class ChatArchiveChannel {
  private readonly bridge = createContext(new BroadcastChannel('airi:chat-archive'), { closeOnDispose: true })

  constructor(onChanged?: () => void) {
    if (onChanged)
      this.bridge.context.on(archiveChangedEvent, onChanged)
  }

  changed() {
    return this.bridge.context.emit(archiveChangedEvent, undefined)
  }

  dispose() {
    this.bridge.dispose()
  }
}

/** Repository deletions invalidate readers even when they originate from another history interface. */
export async function publishArchiveChange() {
  const channel = new ChatArchiveChannel()
  try {
    await channel.changed()
  }
  finally {
    channel.dispose()
  }
}
