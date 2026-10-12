import * as v from 'valibot'

import { brainPromptDefaults } from './prompts'

/** Confirmed user input and delivered assistant output share one bounded source of facts. */
export interface ConversationFact {
  id: string
  role: 'user' | 'assistant'
  text: string
}

/** Configuration is shared with the worker's tool gates; it is not proof that a remote service succeeded. */
export interface ThinkingCapabilities {
  configured: boolean
  web_search: 'disabled' | 'enabled' | 'blocked'
  search_error?: string
}

export function thinkingCapabilityInstructions(capabilities: ThinkingCapabilities) {
  return `Application current background capabilities (configuration data, not a completed lookup):
${JSON.stringify(capabilities)}
This current configuration supersedes historical claims about unavailable tools. Fast-provider native search being disabled does not disable the background worker's web_search.
When web_search is enabled, delegate requested online lookups, current facts, and source verification to spawn_thinking. Do not claim the assistant has no internet permission before attempting the available worker.
When search is disabled or blocked, explain that current limitation truthfully. A blocked search reports an actual service error; do not invent an alternative result. Other background work can still be delegated when configured.`
}

export const thinkingRequestSchema = v.object({
  objective: v.pipe(v.string(), v.minLength(1), v.maxLength(2000)),
  task_id: v.optional(v.string()),
  task_version: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  // Voice handoffs supply character-authored speech. Text tasks have no acceptance audio.
  acknowledgement: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(160))),
  waiting_utterance: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(160))),
})
export const taskReferenceSchema = v.object({
  task_id: v.string(),
  task_version: v.pipe(v.number(), v.integer(), v.minValue(1)),
})
export const deliveryControlSchema = v.object({ mode: v.picklist(['paused', 'automatic']) })

export const thinkingOutputSchema = v.object({
  status: v.picklist(['completed', 'failed', 'needs_input']),
  result_summary: v.pipe(v.string(), v.minLength(1), v.maxLength(3000)),
  suggested_utterance: v.pipe(v.string(), v.minLength(1), v.maxLength(1000)),
  delivery_policy: v.picklist(['when_idle', 'context_only', 'immediate']),
})
export type ThinkingOutput = v.InferOutput<typeof thinkingOutputSchema>

/** Evidence comes from executed tools or provider citations, never from model-authored provenance. */
export interface ThinkingEvidence {
  source: string
  summary: string
}

export interface ThinkingResult extends ThinkingOutput {
  task_id: string
  task_version: number
  evidence: ThinkingEvidence[]
}

/** Progress describes runtime and tool events only. It never contains provider reasoning, tool arguments, or raw results. */
export interface ThinkingProgress {
  stage: 'queued' | 'working' | 'tool_started' | 'tool_returned' | 'tool_failed'
  tool_name?: string
}

export interface ThinkingTask {
  task_id: string
  task_version: number
  objective: string
  source_turn_id: string
  status: 'queued' | 'running' | ThinkingOutput['status'] | 'cancelled'
  delivery: 'pending' | 'speaking' | 'delivered' | 'context_only'
  result?: ThinkingResult
  accepted_at: number
  progress: ThinkingProgress
}

/** Model and tool IO runs outside the scheduler. Aborting a task prevents new tool calls and late result delivery. */
export type ThinkingExecutor = (task: Readonly<ThinkingTask>, facts: ConversationFact[], signal: AbortSignal, reportProgress?: (progress: ThinkingProgress) => void) => Promise<ThinkingOutput & { evidence: ThinkingEvidence[] }>

/**
 * Owns one conversation's FIFO task queue, revisions, and delivery acknowledgements.
 * New chat facts do not cancel tasks. Explicit revisions and cancellation abort the matching version.
 * Disposal rejects in-flight work and removes facts. Model reasoning and raw tool output stay outside this runtime.
 */
export class BrainRuntime {
  private facts: ConversationFact[] = []
  private tasks: ThinkingTask[] = []
  private readonly controllers = new Map<string, AbortController>()
  private readonly revisions = new Map<string, string>()
  private working = false
  private disposed = false
  private sourceTurnId?: string

  constructor(private readonly execute: ThinkingExecutor, private readonly onChange: () => void, private readonly failure: ThinkingOutput) {}

  record(fact: ConversationFact, currentInput = true) {
    if (this.disposed)
      return
    this.facts = this.facts.filter(item => item.id !== fact.id)
    this.facts.push({ ...fact, text: fact.text.slice(0, 4000) })
    if (fact.role === 'user' && currentInput)
      this.sourceTurnId = fact.id
    let length = this.facts.reduce((total, item) => total + item.text.length, 0)
    while (this.facts.length > 64 || length > 16000)
      length -= this.facts.shift()!.text.length
  }

  snapshot() {
    return structuredClone(this.tasks)
  }

  factsSnapshot() {
    return structuredClone(this.facts)
  }

  submit(request: v.InferOutput<typeof thinkingRequestSchema>) {
    request = v.parse(thinkingRequestSchema, request)
    if (this.disposed)
      throw new Error('Conversation ended')
    const source = this.facts.find(fact => fact.id === this.sourceTurnId)
    if (!source)
      throw new Error('A current user request is required')
    const key = JSON.stringify([source.id, request.task_id, request.objective])
    const previousReceipt = this.revisions.get(key)
    const previousTask = this.tasks.find(task => task.task_id === previousReceipt)
    if (previousTask)
      return structuredClone(previousTask)
    let task: ThinkingTask
    if (request.task_id) {
      const previous = this.tasks.find(item => item.task_id === request.task_id)
      if (!previous || previous.task_version !== request.task_version)
        throw new Error('Task version changed')
      this.controllers.get(previous.task_id)?.abort()
      task = { ...previous, task_version: previous.task_version + 1, source_turn_id: source.id, objective: request.objective, status: 'queued', delivery: 'pending', result: undefined, accepted_at: Date.now(), progress: { stage: 'queued' } }
      this.tasks = this.tasks.map(item => item.task_id === task.task_id ? task : item)
    }
    else {
      this.tasks = this.tasks.filter(item => item.status !== 'cancelled' && item.delivery !== 'delivered' && item.delivery !== 'context_only')
      if (this.tasks.length >= 8)
        throw new Error('Task queue is full')
      task = { task_id: crypto.randomUUID(), task_version: 1, objective: request.objective, source_turn_id: source.id, status: 'queued', delivery: 'pending', accepted_at: Date.now(), progress: { stage: 'queued' } }
      this.tasks.push(task)
    }
    this.revisions.set(key, task.task_id)
    // Receipts are call-session state, bounded independently of task history.
    if (this.revisions.size > 128)
      this.revisions.delete(this.revisions.keys().next().value!)
    this.onChange()
    void this.pump()
    return structuredClone(task)
  }

  cancel(reference: v.InferOutput<typeof taskReferenceSchema>) {
    const task = this.tasks.find(item => item.task_id === reference.task_id && item.task_version === reference.task_version)
    if (!task)
      return false
    this.controllers.get(task.task_id)?.abort()
    task.status = 'cancelled'
    task.result = undefined
    task.delivery = 'context_only'
    this.onChange()
    return true
  }

  private async pump() {
    if (this.working || this.disposed)
      return
    this.working = true
    try {
      let task = this.tasks.find(item => item.status === 'queued')
      while (task && !this.disposed) {
        const current = task
        const controller = new AbortController()
        this.controllers.set(current.task_id, controller)
        current.status = 'running'
        current.progress = { stage: 'working' }
        this.onChange()
        const timer = setTimeout(() => controller.abort(), 90000)
        const aborted = new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener('abort', () => reject(new Error('Task stopped')), { once: true })
        })
        try {
          const output = await Promise.race([this.execute(structuredClone(current), this.factsSnapshot(), controller.signal, (progress) => {
            if (!this.isCurrent(current))
              return
            current.progress = { stage: progress.stage, ...(progress.tool_name ? { tool_name: progress.tool_name.slice(0, 64) } : {}) }
            this.onChange()
          }), aborted])
          if (this.isCurrent(current)) {
            const validated = v.parse(thinkingOutputSchema, output)
            current.result = { ...validated, task_id: current.task_id, task_version: current.task_version, evidence: output.evidence.slice(0, 12).map(item => ({ source: item.source.slice(0, 256), summary: item.summary.slice(0, 800) })) }
            current.status = validated.status
            current.delivery = validated.delivery_policy === 'context_only' ? 'context_only' : 'pending'
          }
        }
        catch {
          if (this.isCurrent(current)) {
            current.status = 'failed'
            current.result = { ...this.failure, task_id: current.task_id, task_version: current.task_version, evidence: [] }
          }
        }
        finally {
          clearTimeout(timer)
          this.controllers.delete(current.task_id)
          this.onChange()
        }
        task = this.tasks.find(item => item.status === 'queued')
      }
    }
    finally { this.working = false }
  }

  private isCurrent(task: ThinkingTask) {
    return !this.disposed && this.tasks.includes(task) && task.status === 'running'
  }

  /** Pending results stay in the application delivery queue; confirmed and context-only results enter model context. */
  context() {
    const rows = this.tasks.filter(task => task.status !== 'cancelled').map(task => ({
      task_id: task.task_id,
      task_version: task.task_version,
      objective: task.objective.slice(0, 160),
      status: task.status,
      delivery: task.delivery,
      progress: task.progress,
      // The application owns pending speech. Exposing its text to the model creates a second delivery path.
      result: task.result && (task.delivery === 'delivered' || task.delivery === 'context_only') ? { status: task.result.status, result_summary: task.result.result_summary.slice(0, 240), evidence: task.result.evidence.slice(0, 1).map(item => ({ source: item.source.slice(0, 128) })) } : undefined,
    }))
    while (JSON.stringify(rows).length > 4500 && rows.length > 1) {
      const delivered = rows.findIndex(row => row.delivery === 'delivered' || row.delivery === 'context_only')
      rows.splice(delivered >= 0 ? delivered : rows.length - 1, 1)
    }
    return JSON.stringify(rows)
  }

  claimDelivery() {
    const task = this.tasks.find(item => item.result && item.delivery === 'pending' && item.status !== 'cancelled')
    if (!task)
      return
    task.delivery = 'speaking'
    this.onChange()
    return structuredClone(task.result!)
  }

  acknowledge(reference: Pick<ThinkingResult, 'task_id' | 'task_version'>, delivered: boolean) {
    const task = this.tasks.find(item => item.task_id === reference.task_id && item.task_version === reference.task_version)
    if (task?.delivery === 'speaking') {
      task.delivery = delivered ? 'delivered' : 'pending'
      this.onChange()
    }
  }

  dispose() {
    this.disposed = true
    for (const controller of this.controllers.values())
      controller.abort()
    this.controllers.clear()
    this.facts = []
    this.tasks = []
    this.revisions.clear()
    this.sourceTurnId = undefined
  }
}

/** Stable fast-brain tools carry task identity and version. Unconfigured backends omit task creation. */
export function brainTools(enabled: boolean) {
  const properties = { task_id: { type: 'string', description: 'Task ID from its acceptance receipt.' }, task_version: { type: 'integer', description: 'Current task version from its receipt or status.' } }
  const tools = [
    { type: 'function', name: 'get_agent_task_status', description: 'Read current background tasks and versions. Do not start new work for a status question.', parameters: { type: 'object', properties: {}, required: [] } },
    { type: 'function', name: 'cancel_agent_task', description: 'Cancel the identified version only when the current user explicitly cancels that work.', parameters: { type: 'object', properties, required: ['task_id', 'task_version'] } },
    { type: 'function', name: 'set_agent_delivery', description: 'Pause or resume application automatic conversation and background-result speech only on the current user request. Use paused for quiet. Pausing does not cancel tasks. Use automatic when the user requests pending results or asks to continue.', parameters: { type: 'object', properties: { mode: { type: 'string', enum: ['paused', 'automatic'] } }, required: ['mode'] } },
  ]
  if (enabled) {
    return [...tools, { type: 'function', name: 'spawn_thinking', description: 'Delegate online lookups and current facts to the worker when its web_search is enabled. Also delegate records, other tools, or sustained thinking. Return acceptance immediately. Revise only when the user changes that task. Include its ID and current version for a revision. Casual chat does not cancel work.', parameters: { type: 'object', properties: { ...properties, objective: { type: 'string', description: 'Self-contained user objective with current constraints. No invented requirements.' }, acknowledgement: { type: 'string', maxLength: 160, description: 'One brief Chinese acceptance in the current character voice. Say what you will do, never claim findings or completed tools. No markup or animation tokens. The application reads it once after acceptance.' }, waiting_utterance: { type: 'string', maxLength: 160, description: 'One brief Chinese waiting phrase in the same character voice, read only if work is still pending later. Say only that this request is still being handled. No specific tool progress, ETA, findings, markup, or questions.' } }, required: ['objective', 'acknowledgement', 'waiting_utterance'] } }]
  }
  return tools
}

export const fastBrainInstructions = brainPromptDefaults.fast
