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

  it('submits an owner message in a guild channel only when the bot is mentioned', async () => {
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
      kind: 'message', eventId: 'plain', userId: '123', guildId: 'guild', channelId: 'channel',
      contextKind: 'channel', text: 'ignore me', attachments: [], mentionsBot: false,
    })
    expect(submit).not.toHaveBeenCalled()
    expect(state.conversation('channel')).toBeUndefined()
    await router.handle({
      kind: 'message', eventId: 'mentioned', userId: '123', guildId: 'guild', channelId: 'channel',
      contextKind: 'channel', text: 'fix it', attachments: [], mentionsBot: true,
    })
    expect(submit).toHaveBeenCalledWith('fix it', 'channel', false, [])
    expect(state.conversation('channel')).toMatchObject({ guildId: 'guild', kind: 'channel' })
    await state.close()
  })

  it('continues a bound thread without a mention and ignores an unbound thread', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-discord-router-'))
    directories.push(directory)
    const state = new StateStore(join(directory, 'state.json'))
    await state.touchConversation({ channelId: 'bound-thread', guildId: 'guild', kind: 'thread' })
    await state.setSessionId('bound-thread', 'persisted-session')
    const transport = new FakeDiscordTransport()
    const submit = vi.fn().mockResolvedValue(undefined)
    const router = new BridgeRouter(
      transport, new SecurityPolicy({ ownerId: '123', projectRoot: directory }), state,
      { submit, hasSession: () => false } as unknown as AgentController,
      { handle: () => undefined } as unknown as ApprovalInteraction,
      { handle: () => undefined } as unknown as QuestionInteraction,
    )
    await router.handle({
      kind: 'message', eventId: 'bound', userId: '123', guildId: 'guild', channelId: 'bound-thread',
      contextKind: 'thread', text: 'continue', attachments: [], mentionsBot: false,
    })
    await router.handle({
      kind: 'message', eventId: 'unknown', userId: '123', guildId: 'guild', channelId: 'unknown-thread',
      contextKind: 'thread', text: 'ignore', attachments: [], mentionsBot: false,
    })
    expect(submit).toHaveBeenCalledOnce()
    expect(submit).toHaveBeenCalledWith('continue', 'bound-thread', false, [])
    expect(state.conversation('unknown-thread')).toBeUndefined()
    await state.close()
  })

  it('requires a mention for the first message in an unbound thread', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-discord-router-'))
    directories.push(directory)
    const state = new StateStore(join(directory, 'state.json'))
    const transport = new FakeDiscordTransport()
    const submit = vi.fn().mockResolvedValue(undefined)
    const router = new BridgeRouter(
      transport, new SecurityPolicy({ ownerId: '123', projectRoot: directory }), state,
      { submit, hasSession: () => false } as unknown as AgentController,
      { handle: () => undefined } as unknown as ApprovalInteraction,
      { handle: () => undefined } as unknown as QuestionInteraction,
    )
    await router.handle({
      kind: 'message', eventId: 'first', userId: '123', guildId: 'guild', channelId: 'thread',
      contextKind: 'thread', text: 'start here', attachments: [], mentionsBot: true,
    })
    expect(submit).toHaveBeenCalledWith('start here', 'thread', false, [])
    expect(state.conversation('thread')).toMatchObject({ guildId: 'guild', kind: 'thread' })
    await state.close()
  })

  it('continues a live thread while its Session is still being opened', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-discord-router-'))
    directories.push(directory)
    const state = new StateStore(join(directory, 'state.json'))
    const transport = new FakeDiscordTransport()
    const submit = vi.fn().mockResolvedValue(undefined)
    const router = new BridgeRouter(
      transport, new SecurityPolicy({ ownerId: '123', projectRoot: directory }), state,
      { submit, hasSession: (channelId: string) => channelId === 'live-thread' } as unknown as AgentController,
      { handle: () => undefined } as unknown as ApprovalInteraction,
      { handle: () => undefined } as unknown as QuestionInteraction,
    )
    await router.handle({
      kind: 'message', eventId: 'live', userId: '123', guildId: 'guild', channelId: 'live-thread',
      contextKind: 'thread', text: 'queued continuation', attachments: [], mentionsBot: false,
    })
    expect(submit).toHaveBeenCalledWith('queued continuation', 'live-thread', false, [])
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
      contextKind: 'channel', text: '', attachments: [{ id: 'a', name: 'x.txt', size: 1, read }], mentionsBot: true,
    })
    expect(submit).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
    expect(transport.sent).toHaveLength(0)
    await state.close()
  })

  it('runs slash commands in guild channels without a mention', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-discord-router-'))
    directories.push(directory)
    const state = new StateStore(join(directory, 'state.json'))
    const transport = new FakeDiscordTransport()
    const router = new BridgeRouter(
      transport, new SecurityPolicy({ ownerId: '123', projectRoot: directory }), state,
      { status: () => 'idle' } as unknown as AgentController,
      { handle: () => undefined } as unknown as ApprovalInteraction,
      { handle: () => undefined } as unknown as QuestionInteraction,
    )
    const response = await router.handle({
      kind: 'command', eventId: 'slash', userId: '123', guildId: 'guild', channelId: 'channel',
      contextKind: 'channel', command: 'status',
    })
    expect(response).toEqual({ kind: 'reply', content: 'idle' })
    await state.close()
  })

  it('parses only the supported textual command form', () => {
    expect(parseTextCommand('/dsh steer fix tests')).toEqual({ command: 'steer', text: 'fix tests' })
    expect(parseTextCommand('/dsh help')).toEqual({ command: 'help' })
    expect(parseTextCommand('/dsh status')).toEqual({ command: 'status' })
    expect(parseTextCommand('/other status')).toBeUndefined()
  })

  it('returns trigger rules from the help command without starting an Agent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-discord-router-'))
    directories.push(directory)
    const state = new StateStore(join(directory, 'state.json'))
    const submit = vi.fn()
    const router = new BridgeRouter(
      new FakeDiscordTransport(), new SecurityPolicy({ ownerId: '123', projectRoot: directory }), state,
      { submit } as unknown as AgentController,
      { handle: () => undefined } as unknown as ApprovalInteraction,
      { handle: () => undefined } as unknown as QuestionInteraction,
    )
    const response = await router.handle({
      kind: 'command', eventId: 'help', userId: '123', channelId: 'dm', contextKind: 'dm', command: 'help',
    })
    expect(response).toMatchObject({ kind: 'reply' })
    if (response?.kind !== 'reply') throw new Error('expected help reply')
    expect(response.content).toContain('/dsh steer')
    expect(response.content).toContain('Guild')
    expect(submit).not.toHaveBeenCalled()
    await state.close()
  })
})
