import type { ThinkingExecutor, ThinkingOutput, ThinkingProgress } from './brain'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { BrainRuntime, brainTools } from './brain'

const output: ThinkingOutput & { evidence: { source: string, summary: string }[] } = { status: 'completed', result_summary: 'Verified record B', suggested_utterance: '刚才的记录核对好了。', evidence: [{ source: 'tool:records', summary: 'Record B' }], delivery_policy: 'when_idle' }
const runtimes: BrainRuntime[] = []

afterEach(() => {
  runtimes.splice(0).forEach(runtime => runtime.dispose())
  vi.useRealTimers()
})

function fixture(execute: ThinkingExecutor) {
  const changed = vi.fn()
  const runtime = new BrainRuntime(execute, changed, { ...output, status: 'failed' })
  runtimes.push(runtime)
  runtime.record({ id: 'user-1', role: 'user', text: 'Look up record A' })
  return { runtime, changed }
}

describe('fast and slow brain coordination', () => {
  it('projects actual progress and rejects progress from a superseded task version', async () => {
    const reports: Array<(progress: ThinkingProgress) => void> = []
    const { runtime } = fixture((_task, _facts, _signal, reportProgress) => {
      reports.push(reportProgress!)
      return new Promise(() => {})
    })
    const first = runtime.submit({ objective: 'Look up A' })
    reports[0]({ stage: 'tool_started', tool_name: 'web_search' })
    expect(JSON.parse(runtime.context())[0].progress).toEqual({ stage: 'tool_started', tool_name: 'web_search' })
    runtime.submit({ objective: 'Look up B', task_id: first.task_id, task_version: first.task_version })
    await vi.waitFor(() => expect(reports).toHaveLength(2))
    reports[0]({ stage: 'tool_failed', tool_name: 'stale-tool' })
    expect(runtime.snapshot()[0].progress).toEqual({ stage: 'working' })
    reports[1]({ stage: 'tool_returned', tool_name: 'read_conversation_records' })
    expect(runtime.snapshot()[0].progress).toEqual({ stage: 'tool_returned', tool_name: 'read_conversation_records' })
    expect(runtime.context()).not.toContain('stale-tool')
  })

  it('accepts work immediately, keeps casual conversation, and separates results from delivery', async () => {
    let complete!: (value: typeof output) => void
    const execute = vi.fn<ThinkingExecutor>(() => new Promise((resolve) => {
      complete = resolve
    }))
    const { runtime } = fixture(execute)
    const accepted = runtime.submit({ objective: 'Look up record A' })
    expect(accepted.task_version).toBe(1)
    expect(execute).toHaveBeenCalledOnce()
    runtime.record({ id: 'user-2', role: 'user', text: 'By the way, hello!' })
    expect(runtime.snapshot()[0].status).toBe('running')
    complete(output)
    await vi.waitFor(() => expect(runtime.snapshot()[0].status).toBe('completed'))
    expect(runtime.context()).not.toContain('Verified record B')
    expect(runtime.snapshot()[0].delivery).toBe('pending')
    const result = runtime.claimDelivery()!
    expect(result.evidence[0].source).toBe('tool:records')
    expect(runtime.claimDelivery()).toBeUndefined()
    runtime.acknowledge(result, false)
    expect(runtime.snapshot()[0].delivery).toBe('pending')
    runtime.acknowledge(runtime.claimDelivery()!, true)
    expect(runtime.snapshot()[0].delivery).toBe('delivered')
    expect(runtime.context()).toContain('Verified record B')
  })

  it('aIRI-016 rejects late version A after revision B, even when the provider ignores abort', async () => {
    const completions: Array<(value: typeof output) => void> = []
    const signals: AbortSignal[] = []
    const { runtime } = fixture((_task, _facts, signal) => {
      signals.push(signal)
      return new Promise((resolve) => {
        completions.push(resolve)
      })
    })
    const first = runtime.submit({ objective: 'Look up A' })
    runtime.record({ id: 'user-2', role: 'user', text: 'Change that to B' })
    const revised = runtime.submit({ objective: 'Look up B', task_id: first.task_id, task_version: 1 })
    expect(revised.task_id).toBe(first.task_id)
    expect(revised.task_version).toBe(2)
    expect(signals[0].aborted).toBe(true)
    await vi.waitFor(() => expect(completions).toHaveLength(2))
    completions[0]({ ...output, result_summary: 'Stale A' })
    completions[1](output)
    await vi.waitFor(() => expect(runtime.snapshot()[0].status).toBe('completed'))
    expect(runtime.context()).not.toContain('Stale A')
    expect(runtime.claimDelivery()?.task_version).toBe(2)
    runtime.acknowledge(first, true)
    expect(runtime.snapshot()[0].delivery).toBe('speaking')
  })

  it('cancels only the named current version and deduplicates repeated task creation', async () => {
    const execute = vi.fn<ThinkingExecutor>(() => new Promise(() => {}))
    const { runtime } = fixture(execute)
    const first = runtime.submit({ objective: 'Look up A' })
    expect(runtime.submit({ objective: 'Look up A' }).task_id).toBe(first.task_id)
    expect(execute).toHaveBeenCalledOnce()
    expect(runtime.cancel({ ...first, task_version: 2 })).toBe(false)
    expect(runtime.cancel(first)).toBe(true)
    expect(runtime.claimDelivery()).toBeUndefined()
    expect(runtime.context()).not.toContain(first.task_id)
  })

  it('requires live user input, bounds shared facts, and clears state on disposal', () => {
    const runtime = new BrainRuntime(async () => output, () => {}, { ...output, status: 'failed' })
    runtimes.push(runtime)
    runtime.record({ id: 'history', role: 'user', text: 'Old request' }, false)
    expect(() => runtime.submit({ objective: 'Unrequested work' })).toThrow('current user request')
    for (let index = 0; index < 100; index++)
      runtime.record({ id: String(index), role: 'user', text: 'x'.repeat(4000) })
    expect(runtime.factsSnapshot()).toHaveLength(4)
    runtime.dispose()
    expect(runtime.factsSnapshot()).toHaveLength(0)
    expect(() => runtime.submit({ objective: 'After close' })).toThrow('Conversation ended')
  })

  it('keeps context-only results silent and omits delegation without a backend', async () => {
    const { runtime } = fixture(async () => ({ ...output, delivery_policy: 'context_only' }))
    runtime.submit({ objective: 'Update context' })
    await vi.waitFor(() => expect(runtime.snapshot()[0].status).toBe('completed'))
    expect(runtime.claimDelivery()).toBeUndefined()
    expect(runtime.context()).toContain('Verified record B')
    expect(brainTools(false).some(tool => tool.name === 'spawn_thinking')).toBe(false)
    expect(brainTools(true).some(tool => tool.name === 'spawn_thinking')).toBe(true)
  })

  it('times out work without blocking subsequent tasks or leaking provider errors', async () => {
    vi.useFakeTimers()
    const execute = vi.fn<ThinkingExecutor>().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(output)
    const { runtime } = fixture(execute)
    runtime.submit({ objective: 'Never finishes' })
    runtime.submit({ objective: 'Next task' })
    await vi.advanceTimersByTimeAsync(90001)
    expect(runtime.snapshot()[0].status).toBe('failed')
    expect(runtime.snapshot()[1].status).toBe('completed')
  })
})
