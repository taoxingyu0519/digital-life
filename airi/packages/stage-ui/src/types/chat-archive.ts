/** A persisted conversation relationship, independent of the selected session. */
export interface ArchivePartner {
  userId: string
  displayName: string
  characterId: string
  sessions: number
  updatedAt: number
  preview: string
}

/** User and agent annotations share this record. Original messages remain unchanged. */
export interface ArchiveAnnotation {
  starred: boolean
  tags: string[]
  note: string
  summary: string
  updatedAt: number
  author: 'user' | 'agent'
}

/** Stable source reference. Early imported messages without IDs remain readable by position. */
export interface ArchiveMessage {
  sessionId: string
  messageId: string | null
  position: number
  role: 'user' | 'assistant'
  text: string
  at: number | null
  sessionAt: number
  interrupted: boolean
  derived: boolean
  attachments: number
  annotation: ArchiveAnnotation | null
}

/** A bounded page, ordered chronologically within the returned range. */
export interface ArchivePage {
  messages: ArchiveMessage[]
  nextCursor: string | null
  total: number
}

export interface ArchiveQuery {
  query?: string
  from?: number
  to?: number
  starred?: boolean
  cursor?: string
  limit?: number
  /** Agent recall excludes interrupted and observation-derived output. @default false */
  forRecall?: boolean
}
