import type {
  DiscordEventHandler,
  DiscordInboundEvent,
  DiscordInteractionResponse,
  DiscordMessagePayload,
  DiscordSentMessage,
  DiscordTransport,
} from './types.js'

/** In-memory Discord transport for keyless tests and embedding. */
export class FakeDiscordTransport implements DiscordTransport {
  readonly sent: Array<DiscordSentMessage & { payload: DiscordMessagePayload }> = []
  readonly edits: Array<DiscordSentMessage & { payload: DiscordMessagePayload }> = []
  registered = false
  stopped = false
  private handler: DiscordEventHandler | undefined
  private sequence = 0

  start(_token: string, handler: DiscordEventHandler): Promise<{ applicationId: string; username: string }> {
    this.handler = handler
    return Promise.resolve({ applicationId: 'fake-application', username: 'fake-dsh' })
  }

  registerCommands(_applicationId: string, _token: string): Promise<void> {
    this.registered = true
    return Promise.resolve()
  }

  send(channelId: string, payload: DiscordMessagePayload): Promise<DiscordSentMessage> {
    const sent = { channelId, messageId: `message-${String(++this.sequence)}`, payload: structuredClone(payload) }
    this.sent.push(sent)
    return Promise.resolve({ channelId: sent.channelId, messageId: sent.messageId })
  }

  edit(message: DiscordSentMessage, payload: DiscordMessagePayload): Promise<void> {
    this.edits.push({ ...message, payload: structuredClone(payload) })
    return Promise.resolve()
  }

  stop(): Promise<void> {
    this.stopped = true
    return Promise.resolve()
  }

  emit(event: DiscordInboundEvent): Promise<DiscordInteractionResponse | void> {
    if (this.handler === undefined) throw new Error('Fake Discord transport is not started')
    return this.handler.handle(event)
  }
}
