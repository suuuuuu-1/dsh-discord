import { describe, expect, it } from 'vitest'
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js'
import {
  discordInvitePermissions,
  discordPermissionError,
  missingDiscordPermissions,
  REQUIRED_DISCORD_PERMISSION_BITS,
} from '../src/discord/permissions.js'

describe('Discord permissions', () => {
  it('uses one permission set for setup invites and doctor diagnostics', () => {
    const invite = new PermissionsBitField(discordInvitePermissions())
    expect(invite.has(PermissionFlagsBits.SendMessagesInThreads)).toBe(true)
    expect(invite.equals(new PermissionsBitField(REQUIRED_DISCORD_PERMISSION_BITS))).toBe(true)
    expect(missingDiscordPermissions(invite)).toEqual([])
  })

  it('reports SendMessagesInThreads when doctor diagnostics lack it', () => {
    const available = new PermissionsBitField(
      REQUIRED_DISCORD_PERMISSION_BITS.filter(flag => flag !== PermissionFlagsBits.SendMessagesInThreads),
    )
    const missingPermissions = missingDiscordPermissions(available)
    expect(missingPermissions).toContain('SendMessagesInThreads')
    expect(discordPermissionError({ guilds: 1, writableChannels: 0, missingPermissions }))
      .toContain('SendMessagesInThreads')
  })
})
