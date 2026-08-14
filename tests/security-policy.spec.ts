import { describe, expect, it } from 'vitest'
import { SecurityPolicy } from '../src/security/policy.js'
import type { DiscordInboundEvent } from '../src/discord/types.js'

const dm: DiscordInboundEvent = {
  kind: 'message', eventId: '1', userId: '123', channelId: 'dm', contextKind: 'dm', text: 'hello', attachments: [],
}

describe('SecurityPolicy', () => {
  it('fails closed without an owner or project', () => {
    expect(new SecurityPolicy({}).authorize(dm)).toContain('未配置 Discord Owner')
    expect(new SecurityPolicy({ ownerId: '123' }).authorize(dm)).toContain('未配置项目目录')
  })

  it('requires the exact owner and accepts Discord contexts exposed to the bot', () => {
    const policy = new SecurityPolicy({ ownerId: '123', projectRoot: '.' })
    expect(policy.authorize(dm)).toBeUndefined()
    expect(policy.authorize({ ...dm, userId: '999' })).toBe('未授权用户。')
    expect(policy.authorize({ ...dm, guildId: 'guild', contextKind: 'channel' })).toBeUndefined()
    expect(policy.authorize({ ...dm, guildId: 'guild', contextKind: 'thread' })).toBeUndefined()
  })
})
