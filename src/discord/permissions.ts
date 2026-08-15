import { PermissionFlagsBits, PermissionsBitField } from 'discord.js'
import type { DiscordDiagnostics } from './types.js'

/** Single source of truth for setup invites and doctor permission checks. */
export const REQUIRED_DISCORD_PERMISSIONS = [
  { flag: PermissionFlagsBits.ViewChannel, name: 'ViewChannel' },
  { flag: PermissionFlagsBits.SendMessages, name: 'SendMessages' },
  { flag: PermissionFlagsBits.SendMessagesInThreads, name: 'SendMessagesInThreads' },
  { flag: PermissionFlagsBits.ReadMessageHistory, name: 'ReadMessageHistory' },
  { flag: PermissionFlagsBits.EmbedLinks, name: 'EmbedLinks' },
  { flag: PermissionFlagsBits.AttachFiles, name: 'AttachFiles' },
] as const

export const REQUIRED_DISCORD_PERMISSION_BITS = REQUIRED_DISCORD_PERMISSIONS.map(permission => permission.flag)

export function discordInvitePermissions(): bigint {
  return new PermissionsBitField(REQUIRED_DISCORD_PERMISSION_BITS).bitfield
}

export function missingDiscordPermissions(available: Readonly<PermissionsBitField>): string[] {
  return REQUIRED_DISCORD_PERMISSIONS
    .filter(permission => !available.has(permission.flag))
    .map(permission => permission.name)
}

/** Return the safe diagnostic failure shown by doctor, if any. */
export function discordPermissionError(diagnostics: DiscordDiagnostics): string | undefined {
  if (diagnostics.guilds === 0) return undefined
  if ((diagnostics.missingPermissions?.length ?? 0) > 0) {
    return `Discord permission check failed: missing ${diagnostics.missingPermissions!.join(', ')}`
  }
  if (diagnostics.writableChannels === 0) {
    return `Discord permission check failed: no text channel grants ${REQUIRED_DISCORD_PERMISSIONS.map(item => item.name).join('/')}`
  }
  return undefined
}
