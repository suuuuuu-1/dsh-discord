import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BridgeRouter, parseTextCommand } from '../src/bridge/router.js'
import { FakeDiscordTransport } from '../src/discord/fake.js'
import { SecurityPolicy } from '../src/security/policy.js'
import { StateStore } from '../src/state/store.js'
import type { AgentController } from '../src/bridge/agent-controller.js'
import type { ApprovalInteraction } from '../src/interaction/approval.js'
import type { QuestionInteraction } from '../src/interaction/questions.js'

const directories: string[] = []
afterEach(async () => Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))))

describe('BridgeRouter', () => {
  it('authenticates, persists dedupe, binds the DM, and routes one followup', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-discord-router-'))
    directories.push(directory)
    const state = new StateStore(join(directory, 'state.json'))
    const transport = new FakeDiscordTransport()
    const submit = vi.fn().mockResolvedValue(undefined)
    const controller = { submit, status: () => 'idle' } as unknown as AgentController
    const router = new BridgeRouter(
      transport,
      new SecurityPolicy({ ownerId: '123', projectRoot: directory }),
      state,
      controller,
      { handle: () => undefined } as unknown as ApprovalInteraction,
      { handle: () => undefined } as unknown as QuestionInteraction,
    )
    const event = { kind: 'message', eventId: 'e1', userId: '123', channelId: 'dm', contextKind: 'dm', text: 'do it', attachments: [] } as const
    await router.handle(event)
    await router.handle(event)
    expect(submit).toHaveBeenCalledOnce()
    expect(submit).toHaveBeenCalledWith('do it', 'dm', false, [])
    expect(state.conversation('dm')?.kind).toBe('dm')
    await state.close()
  })

  it('rejects an unauthorized sender before side effects and contains failures', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-discord-router-'))
    directories.push(directory)
    const state = new StateStore(join(directory, 'state.json'))
    const transport = new FakeDiscordTransport()
    const submit = vi.fn().mockRejectedValue(new Error('secret-bearing internal failure'))
    const router = new BridgeRouter(
      transport, new SecurityPolicy({ ownerId: '123', projectRoot: directory }), state,
      { submit } as unknown as AgentController,
      { handle: () => undefined } as unknown as ApprovalInteraction,
      { handle: () => undefined } as unknown as QuestionInteraction,
    )
    await router.handle({ kind: 'message', eventId: 'bad', userId: '999', channelId: 'dm', contextKind: 'dm', text: 'x', attachments: [] })
    expect(submit).not.toHaveBeenCalled()
    await router.handle({ kind: 'message', eventId: 'ok', userId: '123', channelId: 'dm', contextKind: 'dm', text: 'x', attachments: [] })
    expect(transport.sent.at(-1)?.payload.content).not.toContain('secret-bearing')
    await state.close()
  })

  it('accepts owner messages in guild threads and binds a separate conversation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-discord-router-'))
    directories.push(directory)
    const state = new StateStore(join(directory, 'state.json'))
    const transport = new FakeDiscordTransport()
    const submit = vi.fn().mockResolvedValue(undefined)
    const router = new BridgeRouter(
      transport, new SecurityPolicy({ ownerId: '123', projectRoot: directory }), state,
      { submit } as unknown as AgentController,
      { handle: () => undefined } as unknown as ApprovalInteraction,
      { handle: () => undefined } as unknown as QuestionInteraction,
    )
    await router.handle({
      kind: 'message', eventId: 'thread-event', userId: '123', guildId: 'guild', channelId: 'thread',
      contextKind: 'thread', text: 'fix it', attachments: [],
    })
    expect(submit).toHaveBeenCalledWith('fix it', 'thread', false, [])
    expect(state.conversation('thread')).toMatchObject({ guildId: 'guild', kind: 'thread' })
    await state.close()
  })

  it('does not download attachments from unauthorized guild users', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-discord-router-'))
    directories.push(directory)
    const state = new StateStore(join(directory, 'state.json'))
    const read = vi.fn().mockResolvedValue(new Uint8Array([1]))
    const transport = new FakeDiscordTransport()
    const submit = vi.fn()
    const router = new BridgeRouter(
      transport, new SecurityPolicy({ ownerId: '123', projectRoot: directory }), state,
      { submit } as unknown as AgentController,
      { handle: () => undefined } as unknown as ApprovalInteraction,
      { handle: () => undefined } as unknown as QuestionInteraction,
    )
    await router.handle({
      kind: 'message', eventId: 'foreign', userId: '999', guildId: 'guild', channelId: 'channel',
      contextKind: 'channel', text: '', attachments: [{ id: 'a', name: 'x.txt', size: 1, read }],
    })
    expect(submit).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
    expect(transport.sent).toHaveLength(0)
    await state.close()
  })

  it('parses only the supported textual command form', () => {
    expect(parseTextCommand('/dsh steer fix tests')).toEqual({ command: 'steer', text: 'fix tests' })
    expect(parseTextCommand('/dsh status')).toEqual({ command: 'status' })
    expect(parseTextCommand('/other status')).toBeUndefined()
  })
})
