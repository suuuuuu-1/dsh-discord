import { describe, expect, it, vi } from 'vitest'
import { DiscordJsTransport } from '../src/discord/client.js'
import type { DiscordEventHandler, DiscordInboundEvent } from '../src/discord/types.js'

describe('DiscordJsTransport interactions', () => {
  it('defers a /model set command and forwards its subcommand and spec', async () => {
    const order: string[] = []
    const transport = new DiscordJsTransport()
    let received: DiscordInboundEvent | undefined
    const handler: DiscordEventHandler = {
      handle: vi.fn(async (event) => {
        received = event
        order.push('handle')
        return { kind: 'reply' as const, content: 'switched' }
      }),
    }
    const deferReply = vi.fn(async () => { order.push('defer') })
    const editReply = vi.fn(async () => { order.push('edit') })
    const interaction = {
      channelId: 'channel', guildId: 'guild', user: { id: 'owner' }, commandName: 'model',
      channel: { isThread: () => false },
      options: {
        getSubcommand: () => 'set',
        getString: (name: string, required?: boolean) =>
          name === 'spec' && required === true ? 'ollama/glm-5.2:cloud' : null,
      },
      isChatInputCommand: () => true,
      isMessageComponent: () => false,
      isModalSubmit: () => false,
      isRepliable: () => true,
      deferReply,
      editReply,
      reply: vi.fn(),
    }
    const internals = transport as unknown as {
      handler: DiscordEventHandler
      dispatchInteraction(interaction: unknown): Promise<void>
    }
    internals.handler = handler

    await internals.dispatchInteraction(interaction)

    expect(order).toEqual(['defer', 'handle', 'edit'])
    expect(deferReply).toHaveBeenCalledWith({ ephemeral: true })
    expect(editReply).toHaveBeenCalledWith(expect.objectContaining({ content: 'switched' }))
    expect(received).toMatchObject({
      kind: 'command', command: 'model', modelSubcommand: 'set', modelSpec: 'ollama/glm-5.2:cloud',
    })
  })

  it('defers slash commands before waiting for the DSH handler', async () => {
    const order: string[] = []
    const transport = new DiscordJsTransport()
    const handler: DiscordEventHandler = {
      handle: vi.fn(async () => {
        order.push('handle')
        return { kind: 'reply' as const, content: 'created' }
      }),
    }
    const deferReply = vi.fn(async () => { order.push('defer') })
    const editReply = vi.fn(async () => { order.push('edit') })
    const reply = vi.fn()
    const interaction = {
      channelId: 'channel', guildId: null, user: { id: 'owner' }, commandName: 'dsh',
      options: { getSubcommand: () => 'new', getString: () => null },
      isChatInputCommand: () => true,
      isMessageComponent: () => false,
      isModalSubmit: () => false,
      isRepliable: () => true,
      deferReply,
      editReply,
      reply,
    }
    const internals = transport as unknown as {
      handler: DiscordEventHandler
      dispatchInteraction(interaction: unknown): Promise<void>
    }
    internals.handler = handler

    await internals.dispatchInteraction(interaction)

    expect(order).toEqual(['defer', 'handle', 'edit'])
    expect(deferReply).toHaveBeenCalledWith({ ephemeral: true })
    expect(editReply).toHaveBeenCalledWith(expect.objectContaining({ content: 'created' }))
    expect(reply).not.toHaveBeenCalled()
  })

  it('posts a textual command reply back to the channel', async () => {
    // Textual commands (for example `/model status` typed before the Discord
    // client caches the global command) answer without an Agent turn; the reply
    // must reach the channel or the command looks like a no-op.
    const transport = new DiscordJsTransport()
    const internals = transport as unknown as {
      handler: DiscordEventHandler
      send: (channelId: string, payload: { content: string }) => Promise<unknown>
      handleInboundMessage(message: unknown): void
    }
    internals.handler = {
      handle: vi.fn(async () => ({ kind: 'reply' as const, content: '模型状态：deepseek-official/deepseek-v4-flash' })),
    }
    const send = vi.fn(async () => ({ id: 'sent' }))
    internals.send = send
    internals.handleInboundMessage({
      id: 'm1',
      content: '/model status',
      channelId: 'channel-1',
      guildId: null,
      author: { id: 'owner', bot: false },
      mentions: { users: { has: () => false } },
      attachments: [],
      channel: { isThread: () => false },
    })

    await new Promise(resolve => setImmediate(resolve))

    expect(send).toHaveBeenCalledWith('channel-1', { content: '模型状态：deepseek-official/deepseek-v4-flash' })
  })
})
