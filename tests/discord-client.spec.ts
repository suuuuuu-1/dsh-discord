import { describe, expect, it, vi } from 'vitest'
import { DiscordJsTransport } from '../src/discord/client.js'
import type { DiscordEventHandler } from '../src/discord/types.js'

describe('DiscordJsTransport interactions', () => {
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
})
