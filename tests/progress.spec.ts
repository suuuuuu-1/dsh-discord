import { describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { FakeDiscordTransport } from '../src/discord/fake.js'
import { ProgressReporter } from '../src/bridge/progress.js'
import { finalPayload, suppressMentions } from '../src/bridge/renderer.js'

describe('progress and rendering', () => {
  it('coalesces tool updates and never forwards token chunks', async () => {
    vi.useFakeTimers()
    const transport = new FakeDiscordTransport()
    const progress = new ProgressReporter(transport, 100)
    await progress.begin('dm')
    progress.observe({ type: 'assistant/chunk', data: {}, seq: 1, time: 1 } as SessionEvent)
    progress.observe({ type: 'tool/call', data: { name: 'read_file' }, seq: 2, time: 2 } as SessionEvent)
    progress.observe({ type: 'tool/call', data: { name: 'bash' }, seq: 3, time: 3 } as SessionEvent)
    expect(transport.edits).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(100)
    expect(transport.edits).toHaveLength(1)
    expect(transport.edits[0]?.payload.content).toContain('bash')
    vi.useRealTimers()
  })

  it('suppresses mentions and attaches long Markdown results', () => {
    expect(suppressMentions('@everyone <@123> <@&456>')).toBe('@\u200beveryone <@\u200b123> <@\u200b&456>')
    const payload = finalPayload('x'.repeat(3000), 'completed')
    expect(payload.file?.name).toBe('dsh-result.md')
    expect(payload.content).toContain('结果较长')
  })
})
