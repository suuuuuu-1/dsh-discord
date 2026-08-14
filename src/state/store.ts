import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const STATE_VERSION = 2

export type DiscordContextKind = 'dm' | 'channel' | 'thread'

/** One Discord conversation maps to one durable DSH Session. */
export interface ConversationState {
  channelId: string
  guildId?: string
  kind: DiscordContextKind
  sessionId?: string
}

/** Persisted bridge state; Discord event ids are claimed before side effects. */
export interface BridgeState {
  version: 2
  conversations: Record<string, ConversationState>
  seenEventIds: string[]
}

interface LegacyBridgeState {
  version: 1
  sessionId?: string
  channelId?: string
  seenEventIds: string[]
}

/** Atomic JSON state store with a bounded durable deduplication window. */
export class StateStore {
  private state: BridgeState = { version: STATE_VERSION, conversations: {}, seenEventIds: [] }
  private writes: Promise<void> = Promise.resolve()
  private closed = false

  constructor(private readonly filename: string, private readonly maxSeenEvents = 2048) {}

  async load(): Promise<void> {
    let text: string
    try {
      text = await readFile(this.filename, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    const parsed: unknown = JSON.parse(text)
    if (isBridgeState(parsed)) {
      this.state = structuredClone(parsed)
      return
    }
    if (isLegacyBridgeState(parsed)) {
      const conversations = parsed.channelId === undefined ? {} : {
        [parsed.channelId]: {
          channelId: parsed.channelId,
          kind: 'dm' as const,
          ...(parsed.sessionId === undefined ? {} : { sessionId: parsed.sessionId }),
        },
      }
      this.state = { version: STATE_VERSION, conversations, seenEventIds: [...parsed.seenEventIds] }
      return
    }
    throw new Error(`dsh-discord: invalid state document at ${this.filename}`)
  }

  snapshot(): Readonly<BridgeState> {
    return structuredClone(this.state)
  }

  conversation(channelId: string): Readonly<ConversationState> | undefined {
    const value = this.state.conversations[channelId]
    return value === undefined ? undefined : structuredClone(value)
  }

  async claimEvent(eventId: string): Promise<boolean> {
    if (this.state.seenEventIds.includes(eventId)) return false
    this.state.seenEventIds.push(eventId)
    if (this.state.seenEventIds.length > this.maxSeenEvents) {
      this.state.seenEventIds.splice(0, this.state.seenEventIds.length - this.maxSeenEvents)
    }
    await this.persist()
    return true
  }

  async touchConversation(input: Omit<ConversationState, 'sessionId'>): Promise<void> {
    const current = this.state.conversations[input.channelId]
    if (current !== undefined && current.guildId === input.guildId && current.kind === input.kind) return
    const sessionId = current?.sessionId
    this.state.conversations[input.channelId] = {
      ...input,
      ...(sessionId === undefined ? {} : { sessionId }),
    }
    await this.persist()
  }

  async setSessionId(channelId: string, sessionId: string | undefined): Promise<void> {
    const current = this.state.conversations[channelId]
    if (current === undefined) throw new Error('dsh-discord: conversation is not bound')
    if (sessionId === undefined) delete current.sessionId
    else current.sessionId = sessionId
    await this.persist()
  }

  async close(): Promise<void> {
    this.closed = true
    await this.writes
  }

  private persist(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('dsh-discord: state store is closed'))
    const snapshot = JSON.stringify(this.state, undefined, 2) + '\n'
    const operation = this.writes.then(async () => {
      await mkdir(dirname(this.filename), { recursive: true })
      const temporary = `${this.filename}.${randomUUID()}.tmp`
      await writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      await rename(temporary, this.filename)
    })
    this.writes = operation.catch(() => undefined)
    return operation
  }
}

/** Resolve and validate a configured state filename. */
export function resolveStatePath(filename: string): string {
  return resolve(filename)
}

function isBridgeState(value: unknown): value is BridgeState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const state = value as Record<string, unknown>
  return state.version === STATE_VERSION
    && isConversations(state.conversations)
    && isStringArray(state.seenEventIds)
}

function isLegacyBridgeState(value: unknown): value is LegacyBridgeState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const state = value as Record<string, unknown>
  return state.version === 1
    && (state.sessionId === undefined || typeof state.sessionId === 'string')
    && (state.channelId === undefined || typeof state.channelId === 'string')
    && isStringArray(state.seenEventIds)
}

function isConversations(value: unknown): value is Record<string, ConversationState> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.entries(value).every(([key, item]) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return false
    const record = item as Record<string, unknown>
    return record.channelId === key
      && (record.guildId === undefined || typeof record.guildId === 'string')
      && (record.kind === 'dm' || record.kind === 'channel' || record.kind === 'thread')
      && (record.sessionId === undefined || typeof record.sessionId === 'string')
  })
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}
