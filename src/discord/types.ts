import type { DiscordContextKind } from '../state/store.js'

/** Bounded Discord attachment bytes downloaded before an event enters DSH. */
export interface DiscordInboundAttachment {
  id: string
  name: string
  mediaType?: string
  size: number
  /** Lazily download bytes only after owner authorization and deduplication. */
  read(): Promise<Uint8Array>
}

interface DiscordInboundBase {
  eventId: string
  userId: string
  channelId: string
  guildId?: string
  contextKind: DiscordContextKind
}

/** Transport-neutral Discord bridge events. */
export type DiscordInboundEvent =
  | DiscordInboundBase & {
    kind: 'message'
    text: string
    attachments: readonly DiscordInboundAttachment[]
    /** Whether this message explicitly mentioned the connected bot. */
    mentionsBot?: boolean
  }
  | DiscordInboundBase & {
    kind: 'command'
    command: 'help' | 'status' | 'new' | 'stop' | 'steer'
    text?: string
  }
  | DiscordInboundBase & {
    kind: 'component'
    customId: string
    values?: string[]
    text?: string
  }

/** One button in a transport-neutral component row. */
export interface DiscordButton {
  customId: string
  label: string
  style: 'primary' | 'success' | 'danger' | 'secondary'
  disabled?: boolean
}

/** One select menu in a transport-neutral component row. */
export interface DiscordSelect {
  customId: string
  placeholder: string
  options: Array<{ label: string; description?: string; value: string }>
  minValues: number
  maxValues: number
  disabled?: boolean
}

/** Outbound Discord message with mention-safe defaults enforced by transports. */
export interface DiscordMessagePayload {
  content: string
  buttons?: DiscordButton[]
  select?: DiscordSelect
  file?: { name: string; data: Uint8Array }
}

/** A sent Discord message coordinate. */
export interface DiscordSentMessage {
  channelId: string
  messageId: string
}

/** Response to an interaction event. */
export type DiscordInteractionResponse =
  | { kind: 'reply'; content: string }
  | { kind: 'update'; content: string }
  | { kind: 'modal'; customId: string; title: string; label: string }

/** Event callbacks supplied to a Discord transport. */
export interface DiscordEventHandler {
  handle(event: DiscordInboundEvent): Promise<DiscordInteractionResponse | void>
}

export interface DiscordDiagnostics {
  guilds: number
  writableChannels: number
  /** Permissions unavailable in every inspected guild text channel. */
  missingPermissions?: string[]
}

/** Gateway/REST abstraction used by production and deterministic tests. */
export interface DiscordTransport {
  start(token: string, handler: DiscordEventHandler): Promise<{ applicationId: string; username: string }>
  registerCommands(applicationId: string, token: string): Promise<void>
  send(channelId: string, payload: DiscordMessagePayload): Promise<DiscordSentMessage>
  edit(message: DiscordSentMessage, payload: DiscordMessagePayload): Promise<void>
  diagnose?(): Promise<DiscordDiagnostics>
  stop(): Promise<void>
}
