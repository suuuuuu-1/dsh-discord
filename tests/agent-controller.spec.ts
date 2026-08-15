import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { AgentController } from '../src/bridge/agent-controller.js'
import { FakeDiscordTransport } from '../src/discord/fake.js'
import { StateStore } from '../src/state/store.js'

const directories: string[] = []
afterEach(async () => Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))))

describe('AgentController MVP chain', () => {
  it('creates, follows up, consumes committed session output, and edits the final Discord message', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-discord-agent-'))
    directories.push(directory)
    const state = new StateStore(join(directory, 'state.json'))
    await state.touchConversation({ channelId: 'dm', kind: 'dm' })
    const transport = new FakeDiscordTransport()
    const session = { id: 'session', seq: 0 }
    let status: 'idle' | 'running' = 'idle'
    let idle = Promise.resolve()
    let finish: (() => void) | undefined
    const followup = vi.fn(() => {
      status = 'running'
      idle = new Promise<void>(resolve => { finish = () => { status = 'idle'; resolve() } })
    })
    const agent = {
      id: 'session', session, get status() { return status }, followup, steer: vi.fn(), cancel: vi.fn(),
      whenIdle: () => idle,
    } as unknown as Agent
    const handle = { agent, dispose: vi.fn().mockResolvedValue(undefined) } as AgentHandle
    const create = vi.fn().mockResolvedValue(handle)
    const flush = vi.fn().mockResolvedValue(undefined)
    const ctx = {
      agents: { create, resume: vi.fn() }, sessions: { flush },
      attachments: {
        imageLimits: { maxImageBytes: 10_000_000, maxImagesPerMessage: 4, maxMessageImageBytes: 20_000_000 },
        validateImage: vi.fn(), saveImage: vi.fn(),
      },
      agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
    } as unknown as Context
    const controller = new AgentController(ctx, directory, state, transport, 10)
    await controller.submit('hello', 'dm')
    expect(create).toHaveBeenCalledOnce()
    expect(followup).toHaveBeenCalledOnce()
    expect(transport.sent[0]?.payload.content).toContain('正在运行')
    controller.observe(session, {
      type: 'assistant/message', seq: 1, time: Date.now(),
      data: { turn: 0, step: 0, message: { content: [{ type: 'text', text: 'done @everyone' }] } },
    } as SessionEvent)
    finish?.()
    await vi.waitFor(() => expect(transport.edits.at(-1)?.payload.content).toContain('已完成'))
    expect(transport.edits.at(-1)?.payload.content).toContain('@\u200beveryone')
    expect(flush).toHaveBeenCalledOnce()
    await controller.dispose()
    await state.close()
  })

  it('keeps consecutive followups in one conversation and settles after the whole queue', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-discord-agent-'))
    directories.push(directory)
    const state = new StateStore(join(directory, 'state.json'))
    await state.touchConversation({ channelId: 'thread', guildId: 'guild', kind: 'thread' })
    const transport = new FakeDiscordTransport()
    const session = { id: 'queued-session', seq: 0 }
    let status: 'idle' | 'running' = 'idle'
    let idle = Promise.resolve()
    let finish: (() => void) | undefined
    const followup = vi.fn(() => {
      if (status === 'running') return
      status = 'running'
      idle = new Promise<void>(resolve => { finish = () => { status = 'idle'; resolve() } })
    })
    const agent = {
      id: 'queued-session', session, get status() { return status }, followup,
      steer: vi.fn(), cancel: vi.fn(), whenIdle: () => idle,
    } as unknown as Agent
    const flush = vi.fn().mockResolvedValue(undefined)
    const ctx = {
      agents: {
        create: vi.fn().mockResolvedValue({ agent, dispose: vi.fn().mockResolvedValue(undefined) }),
        resume: vi.fn(),
      },
      sessions: { flush },
      attachments: {
        imageLimits: { maxImageBytes: 10_000_000, maxImagesPerMessage: 4, maxMessageImageBytes: 20_000_000 },
        validateImage: vi.fn(), saveImage: vi.fn(),
      },
      agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
    } as unknown as Context
    const controller = new AgentController(ctx, directory, state, transport, 10)

    await Promise.all([
      controller.submit('first', 'thread'),
      controller.submit('second', 'thread'),
    ])
    expect(followup).toHaveBeenCalledTimes(2)
    expect(transport.sent).toHaveLength(1)
    expect(controller.hasSession('thread')).toBe(true)
    controller.observe(session, {
      type: 'assistant/message', seq: 1, time: Date.now(),
      data: { turn: 1, step: 0, message: { content: [{ type: 'text', text: 'second result' }] } },
    } as SessionEvent)
    finish?.()
    await vi.waitFor(() => expect(transport.edits.at(-1)?.payload.content).toContain('second result'))
    expect(transport.edits.at(-1)?.channelId).toBe('thread')
    expect(flush).toHaveBeenCalledOnce()
    await controller.dispose()
    await state.close()
  })

  it('does not finalize the prior turn while a followup arrives during session flush', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-discord-agent-'))
    directories.push(directory)
    const state = new StateStore(join(directory, 'state.json'))
    await state.touchConversation({ channelId: 'dm', kind: 'dm' })
    const transport = new FakeDiscordTransport()
    const session = { id: 'race-session', seq: 0 }
    let status: 'idle' | 'running' = 'idle'
    let idle = Promise.resolve()
    let finish: (() => void) | undefined
    const followup = vi.fn(() => {
      status = 'running'
      idle = new Promise<void>(resolve => { finish = () => { status = 'idle'; resolve() } })
    })
    const agent = {
      id: 'race-session', session, get status() { return status }, followup,
      steer: vi.fn(), cancel: vi.fn(), whenIdle: () => idle,
    } as unknown as Agent
    let releaseFirstFlush: (() => void) | undefined
    const firstFlush = new Promise<void>(resolve => { releaseFirstFlush = resolve })
    const flush = vi.fn()
      .mockImplementationOnce(() => firstFlush)
      .mockResolvedValue(undefined)
    const ctx = {
      agents: {
        create: vi.fn().mockResolvedValue({ agent, dispose: vi.fn().mockResolvedValue(undefined) }),
        resume: vi.fn(),
      },
      sessions: { flush },
      attachments: {
        imageLimits: { maxImageBytes: 10_000_000, maxImagesPerMessage: 4, maxMessageImageBytes: 20_000_000 },
        validateImage: vi.fn(), saveImage: vi.fn(),
      },
      agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
    } as unknown as Context
    const controller = new AgentController(ctx, directory, state, transport, 10)

    await controller.submit('first', 'dm')
    finish?.()
    await vi.waitFor(() => expect(flush).toHaveBeenCalledOnce())
    await controller.submit('second', 'dm')
    releaseFirstFlush?.()
    controller.observe(session, {
      type: 'assistant/message', seq: 2, time: Date.now(),
      data: { turn: 1, step: 0, message: { content: [{ type: 'text', text: 'latest result' }] } },
    } as SessionEvent)
    finish?.()
    await vi.waitFor(() => expect(transport.edits.at(-1)?.payload.content).toContain('latest result'))
    expect(followup).toHaveBeenCalledTimes(2)
    expect(flush).toHaveBeenCalledTimes(2)
    expect(transport.sent).toHaveLength(1)
    expect(transport.edits.at(-1)?.channelId).toBe('dm')
    await controller.dispose()
    await state.close()
  })

  it('persists image attachments and embeds UTF-8 code attachments in the user message', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-discord-agent-'))
    directories.push(directory)
    const state = new StateStore(join(directory, 'state.json'))
    await state.touchConversation({ channelId: 'thread', guildId: 'guild', kind: 'thread' })
    const transport = new FakeDiscordTransport()
    const followup = vi.fn()
    const agent = {
      id: 'attachment-session', session: { id: 'attachment-session', seq: 0 }, status: 'idle',
      followup, steer: vi.fn(), cancel: vi.fn(), whenIdle: () => Promise.resolve(),
    } as unknown as Agent
    const validateImage = vi.fn().mockResolvedValue(undefined)
    const saveImage = vi.fn().mockResolvedValue({
      attachmentId: `sha256:${'a'.repeat(64)}`, mediaType: 'image/png', bytes: 4, width: 1, height: 1, name: 'shot.png',
    })
    const ctx = {
      agents: { create: vi.fn().mockResolvedValue({ agent, dispose: vi.fn() }), resume: vi.fn() },
      sessions: { flush: vi.fn() },
      attachments: {
        imageLimits: { maxImageBytes: 10_000_000, maxImagesPerMessage: 4, maxMessageImageBytes: 20_000_000 },
        validateImage, saveImage,
      },
      agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
    } as unknown as Context
    const code = new TextEncoder().encode('export const answer = 42\n')
    const controller = new AgentController(ctx, directory, state, transport, 10)
    await controller.submit('', 'thread', false, [
      { id: 'image', name: 'shot.png', mediaType: 'image/png', size: 4, read: () => Promise.resolve(new Uint8Array([1, 2, 3, 4])) },
      { id: 'code', name: 'answer.ts', mediaType: 'text/plain', size: code.byteLength, read: () => Promise.resolve(code) },
    ])
    expect(validateImage).toHaveBeenCalledOnce()
    expect(saveImage).toHaveBeenCalledOnce()
    const message = followup.mock.calls[0]?.[0] as { content: Array<{ type: string; text?: string }> }
    expect(message.content.map(block => block.type)).toEqual(['image', 'text'])
    expect(message.content[1]?.text).toContain('export const answer = 42')
    await controller.dispose()
    await state.close()
  })
})
