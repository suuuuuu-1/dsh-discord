import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { ApprovalInteraction } from '../src/interaction/approval.js'
import { QuestionInteraction } from '../src/interaction/questions.js'
import { FakeDiscordTransport } from '../src/discord/fake.js'
import type { AgentController } from '../src/bridge/agent-controller.js'

const agent = { id: 'agent' } as Agent
const controller = {
  owns: (candidate: Agent) => candidate === agent,
  currentChannel: () => 'dm',
} as unknown as AgentController

describe('Discord interactions', () => {
  it('binds approval to the exact owned agent and consumes it only once', async () => {
    const transport = new FakeDiscordTransport()
    const approvals = new ApprovalInteraction(transport, controller, 10_000)
    expect(approvals.request({ agent: {} as Agent, toolName: 'bash' } as ApprovalRequest)).toBeUndefined()
    const outcome = approvals.request({ agent, toolName: 'bash', reason: 'needs write' } as ApprovalRequest)!
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1))
    const customId = transport.sent[0]!.payload.buttons![0]!.customId
    expect(approvals.handle({
      kind: 'component', eventId: 'click', userId: 'owner', channelId: 'dm', contextKind: 'dm', customId,
    })).toEqual({ kind: 'update', content: '✅ 已允许一次。' })
    await expect(outcome).resolves.toBe('allowed-once')
    expect(approvals.handle({
      kind: 'component', eventId: 'replay', userId: 'owner', channelId: 'dm', contextKind: 'dm', customId,
    })).toEqual({ kind: 'reply', content: '该审批请求不存在或已过期。' })
    approvals.dispose()
  })

  it('cancels pending approval safely on unload', async () => {
    const approvals = new ApprovalInteraction(new FakeDiscordTransport(), controller, 10_000)
    const outcome = approvals.request({ agent, toolName: 'bash' } as ApprovalRequest)!
    approvals.dispose()
    await expect(outcome).resolves.toBe('cancelled')
  })

  it('bounds long approval and question text before sending it to Discord', async () => {
    const transport = new FakeDiscordTransport()
    const approvals = new ApprovalInteraction(transport, controller, 10_000)
    const outcome = approvals.request({
      agent,
      toolName: 'bash',
      reason: `${'x'.repeat(2500)} @everyone`,
    } as ApprovalRequest)!
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1))
    expect(transport.sent[0]?.payload.content).toHaveLength(2000)
    expect(transport.sent[0]?.payload.content).not.toContain('@everyone')
    approvals.dispose()
    await expect(outcome).resolves.toBe('cancelled')

    const questions = new QuestionInteraction(transport, controller, 10_000)
    const answer = questions.ask({ agent, questions: [{ id: 'long', question: 'q'.repeat(2500) }] })
    await vi.waitFor(() => expect(transport.sent).toHaveLength(2))
    expect(transport.sent[1]?.payload.content).toHaveLength(2000)
    questions.dispose()
    await expect(answer).rejects.toThrow('disposed')
  })

  it('returns structured selected and custom question answers', async () => {
    const transport = new FakeDiscordTransport()
    const questions = new QuestionInteraction(transport, controller, 10_000)
    const selectedPromise = questions.ask({ agent, questions: [{
      id: 'choice', question: 'Choose', options: [{ label: 'A' }, { label: 'B' }], multiSelect: true,
    }] })
    await vi.waitFor(() => expect(transport.sent).toHaveLength(1))
    const selectId = transport.sent[0]!.payload.select!.customId
    questions.handle({ kind: 'component', eventId: 's', userId: 'owner', channelId: 'dm', contextKind: 'dm', customId: selectId, values: ['0', '1'] })
    await expect(selectedPromise).resolves.toEqual({ answers: [{ id: 'choice', selected: ['A', 'B'] }] })

    const customPromise = questions.ask({ agent, questions: [{ id: 'free', question: 'Explain' }] })
    await vi.waitFor(() => expect(transport.sent).toHaveLength(2))
    const customButton = transport.sent[1]!.payload.buttons![0]!.customId
    const modal = questions.handle({ kind: 'component', eventId: 'c', userId: 'owner', channelId: 'dm', contextKind: 'dm', customId: customButton })
    expect(modal?.kind).toBe('modal')
    if (modal?.kind !== 'modal') throw new Error('expected modal')
    questions.handle({ kind: 'component', eventId: 'm', userId: 'owner', channelId: 'dm', contextKind: 'dm', customId: modal.customId, text: 'Because' })
    await expect(customPromise).resolves.toEqual({ answers: [{ id: 'free', selected: [], custom: 'Because' }] })
    questions.dispose()
  })
})
