/** The active renderer registers its transient projector. Importing chat never starts camera infrastructure. */
let current: { project: (sessionId: string) => string, scope: (sessionId: string) => string } | undefined
let input: ((text: string, sessionId: string) => Promise<void>) | undefined

/** Registers the local listener without importing camera stores into chat. */
export function registerLocalVisionInput(listener: (text: string, sessionId: string) => Promise<void>) {
  input = listener
  return () => {
    if (input === listener)
      input = undefined
  }
}

/** Resolves real user input before composition so a new name can inform this reply. */
export async function observeLocalVisionInput(text: string, sessionId: string) {
  await input?.(text, sessionId)
}

/** Scope identifies permissions and the encounter, independent of frame timestamps and visible cues. */
export function registerLocalVisionContext(projector: NonNullable<typeof current>) {
  current = projector
  return () => {
    if (current === projector)
      current = undefined
  }
}

/** Read only at the provider boundary. No camera owner means no visual context. */
export function readLocalVisionContext(sessionId: string) {
  return current?.project(sessionId) ?? ''
}

/** Captured drafts remain valid across ordinary frames, but never across permission or encounter changes. */
export function readLocalVisionContextScope(sessionId: string) {
  return current?.scope(sessionId) ?? ''
}
