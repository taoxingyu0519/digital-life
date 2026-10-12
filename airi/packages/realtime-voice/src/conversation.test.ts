import { describe, expect, it } from 'vitest'

import { conversationPolicy, resultSpeechChunks } from './conversation'

describe('conversation policy and canonical speech', () => {
  it('preserves long findings, whitespace, qualifications, and surrogate pairs across TTS chunks', () => {
    const summary = `${'数'.repeat(399)}🙂 正确率 82%，仅测试集 A；跨领域尚未验证。\n${'未验证，不应推断成功。'.repeat(70)}  `
    const chunks = resultSpeechChunks({ task_id: 'public-test', task_version: 1, status: 'completed', result_summary: summary, suggested_utterance: '100%', evidence: [], delivery_policy: 'when_idle' })
    expect(chunks.join('')).toBe(summary)
    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks.every(chunk => chunk.length <= 400 && !/[\uD800-\uDBFF]$/.test(chunk) && !/^[\uDC00-\uDFFF]/.test(chunk))).toBe(true)
  })

  it('disables optional expression and waiting in basic mode while retaining canonical output constraints', () => {
    const basic = conversationPolicy('basic')
    expect(basic.fastInstructions).toBe('')
    expect(basic.waitNoticeAfterMs).toBeUndefined()
    expect(basic.workerInstructions).toContain('应用原样朗读 result_summary')
    expect(conversationPolicy('obsolete-setting').style).toBe('natural')
    expect(conversationPolicy('listening').fastInstructions).toContain('避免主动列建议清单')
    expect(conversationPolicy('concise').waitNoticeAfterMs).toBeUndefined()
  })
})
