import {
  AttachmentBuilder,
  Client,
  DiscordjsErrorCodes,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  Partials,
  PermissionsBitField,
  REST,
  Routes,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  type MessageActionRowComponentBuilder,
  type Interaction,
} from 'discord.js'
import { DSH_COMMAND_BODY } from './commands.js'
import { componentRows } from './components.js'
import {
  missingDiscordPermissions,
  REQUIRED_DISCORD_PERMISSION_BITS,
} from './permissions.js'
import type {
  DiscordDiagnostics,
  DiscordEventHandler,
  DiscordInboundEvent,
  DiscordInteractionResponse,
  DiscordMessagePayload,
  DiscordSentMessage,
  DiscordTransport,
} from './types.js'

/** discord.js Gateway transport. All outbound messages suppress every mention class. */
export class DiscordJsTransport implements DiscordTransport {
  private client: Client | undefined
  private handler: DiscordEventHandler | undefined

  async start(token: string, handler: DiscordEventHandler): Promise<{ applicationId: string; username: string }> {
    if (this.client !== undefined) throw new Error('Discord transport is already started')
    this.handler = handler
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel],
    })
    this.client = client
    // Keep runtime socket errors contained while discord.js performs its own reconnect policy.
    client.on(Events.Error, () => undefined)
    client.on(Events.MessageCreate, (message) => {
      if (message.author.bot) return
      const botId = client.user?.id
      const mentionsBot = botId !== undefined && message.mentions.users.has(botId)
      const event: DiscordInboundEvent = {
        kind: 'message',
        eventId: message.id,
        userId: message.author.id,
        channelId: message.channelId,
        ...(message.guildId === null ? {} : { guildId: message.guildId }),
        contextKind: message.guildId === null ? 'dm' : message.channel.isThread() ? 'thread' : 'channel',
        text: botId === undefined ? message.content : stripBotMention(message.content, botId),
        mentionsBot,
        attachments: message.attachments.map(attachment => ({
          id: attachment.id,
          name: attachment.name,
          ...(attachment.contentType === null ? {} : { mediaType: attachment.contentType }),
          size: attachment.size,
          read: () => this.downloadAttachment(attachment.url, attachment.size),
        })),
      }
      void this.dispatch(event).catch(() => {
        void this.send(message.channelId, { content: 'Discord 消息处理失败，请查看 dsh-discord 日志。' }).catch(() => undefined)
      })
    })
    client.on(Events.InteractionCreate, (interaction) => {
      void this.dispatchInteraction(interaction).catch(() => undefined)
    })
    const ready = new Promise<{ applicationId: string; username: string }>((resolve, reject) => {
      client.once(Events.ClientReady, readyClient => resolve({
        applicationId: readyClient.application.id,
        username: readyClient.user.username,
      }))
      client.once(Events.Error, reject)
    })
    try {
      await client.login(token)
      return await ready
    } catch (error) {
      await this.stop()
      const details = discordErrorDetails(error)
      const code = details.code
      const message = error instanceof Error ? error.message : undefined
      if (code === DiscordjsErrorCodes.TokenInvalid) {
        throw new Error('Discord authentication failed: token was rejected')
      }
      if (code === DiscordjsErrorCodes.DisallowedIntents || message === 'Used disallowed intents') {
        throw new Error('Discord Gateway rejected Message Content Intent; enable it on the Bot page')
      }
      if (details.status === 401 || details.causeStatus === 401) {
        throw new Error('Discord authentication failed: token was rejected')
      }
      throw new Error(`Discord Gateway connection failed (${details.summary})`)
    }
  }

  async registerCommands(applicationId: string, token: string): Promise<void> {
    const rest = new REST({ version: '10' }).setToken(token)
    await rest.put(Routes.applicationCommands(applicationId), { body: [DSH_COMMAND_BODY] })
      .catch(() => { throw new Error('Discord command registration failed') })
  }

  async send(channelId: string, payload: DiscordMessagePayload): Promise<DiscordSentMessage> {
    const client = this.requireClient()
    const channel = await client.channels.fetch(channelId)
    if (channel === null || !channel.isSendable()) throw new Error('Discord channel is unavailable')
    const sent = await channel.send(this.messageOptions(payload))
    return { channelId, messageId: sent.id }
  }

  async edit(message: DiscordSentMessage, payload: DiscordMessagePayload): Promise<void> {
    const client = this.requireClient()
    const channel = await client.channels.fetch(message.channelId)
    if (channel === null || !channel.isSendable() || !('messages' in channel)) {
      throw new Error('Discord channel is unavailable')
    }
    await channel.messages.edit(message.messageId, this.messageOptions(payload))
  }

  async diagnose(): Promise<DiscordDiagnostics> {
    const client = this.requireClient()
    let writableChannels = 0
    let textChannels = 0
    const available = new PermissionsBitField()
    const required = new PermissionsBitField(REQUIRED_DISCORD_PERMISSION_BITS)
    for (const guild of client.guilds.cache.values()) {
      const me = guild.members.me ?? await guild.members.fetchMe()
      const channels = await guild.channels.fetch()
      for (const channel of channels.values()) {
        if (channel?.isTextBased() !== true || channel.isDMBased()) continue
        textChannels += 1
        const permissions = channel.permissionsFor(me)
        if (permissions === null) continue
        available.add(permissions.bitfield)
        if (permissions.has(required)) writableChannels += 1
      }
    }
    return {
      guilds: client.guilds.cache.size,
      writableChannels,
      missingPermissions: textChannels === 0 ? [] : missingDiscordPermissions(available),
    }
  }

  async stop(): Promise<void> {
    const client = this.client
    this.client = undefined
    this.handler = undefined
    client?.destroy()
  }

  private messageOptions(payload: DiscordMessagePayload) {
    return {
      content: payload.content,
      allowedMentions: { parse: [] as never[] },
      components: componentRows(payload),
      files: payload.file === undefined
        ? []
        : [new AttachmentBuilder(Buffer.from(payload.file.data), { name: payload.file.name })],
    }
  }

  private async dispatch(event: DiscordInboundEvent): Promise<DiscordInteractionResponse | void> {
    return this.handler?.handle(event)
  }

  private async dispatchInteraction(interaction: Interaction): Promise<void> {
    if (interaction.channelId === null) return
    let event: DiscordInboundEvent | undefined
    let deferredCommand = false
    if ('isChatInputCommand' in interaction && interaction.isChatInputCommand() && interaction.commandName === 'dsh') {
      const command = interaction.options.getSubcommand() as 'help' | 'status' | 'new' | 'stop' | 'steer'
      event = {
        kind: 'command', eventId: interaction.id, userId: interaction.user.id,
        channelId: interaction.channelId,
        ...(interaction.guildId === null ? {} : { guildId: interaction.guildId }),
        contextKind: interaction.guildId === null ? 'dm' : interaction.channel?.isThread() === true ? 'thread' : 'channel',
        command,
        ...(command === 'steer' ? { text: interaction.options.getString('text', true) } : {}),
      }
      await interaction.deferReply({ ephemeral: true })
      deferredCommand = true
    } else if ('isMessageComponent' in interaction && interaction.isMessageComponent()) {
      event = {
        kind: 'component', eventId: interaction.id, userId: interaction.user.id,
        channelId: interaction.channelId,
        ...(interaction.guildId === null ? {} : { guildId: interaction.guildId }),
        contextKind: interaction.guildId === null ? 'dm' : interaction.channel?.isThread() === true ? 'thread' : 'channel',
        customId: interaction.customId,
        ...interaction.isStringSelectMenu() ? { values: interaction.values } : {},
      }
    } else if ('isModalSubmit' in interaction && interaction.isModalSubmit()) {
      event = {
        kind: 'component', eventId: interaction.id, userId: interaction.user.id,
        channelId: interaction.channelId,
        ...(interaction.guildId === null ? {} : { guildId: interaction.guildId }),
        contextKind: interaction.guildId === null ? 'dm' : interaction.channel?.isThread() === true ? 'thread' : 'channel',
        customId: interaction.customId,
        text: interaction.fields.getTextInputValue('answer'),
      }
    }
    if (event === undefined) return
    let response: DiscordInteractionResponse | void
    try {
      response = await this.dispatch(event)
    } catch {
      response = { kind: 'reply', content: '请求处理失败，请查看 dsh-discord 日志。' }
    }
    if (response === undefined) {
      if (deferredCommand && interaction.isChatInputCommand()) {
        await interaction.editReply({ content: '请求已处理。', allowedMentions: { parse: [] }, components: [] })
      }
      return
    }
    if (response.kind === 'modal') {
      if (!interaction.isMessageComponent()) return
      const input = new TextInputBuilder()
        .setCustomId('answer').setLabel(response.label.slice(0, 45)).setStyle(TextInputStyle.Paragraph).setRequired(true)
      const modal = new ModalBuilder().setCustomId(response.customId).setTitle(response.title.slice(0, 45))
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input))
      await interaction.showModal(modal)
      return
    }
    const options = { content: response.content, allowedMentions: { parse: [] as never[] }, components: [] as ActionRowBuilder<MessageActionRowComponentBuilder>[] }
    if (response.kind === 'update' && interaction.isMessageComponent()) await interaction.update(options)
    else if (deferredCommand && interaction.isChatInputCommand()) await interaction.editReply(options)
    else if (interaction.isRepliable()) await interaction.reply({ ...options, ephemeral: true })
  }

  private requireClient(): Client {
    if (this.client === undefined) throw new Error('Discord transport is not started')
    return this.client
  }

  private async downloadAttachment(url: string, declaredSize: number): Promise<Uint8Array> {
    if (declaredSize > 25 * 1024 * 1024) throw new Error('Discord attachment exceeds the 25 MiB ingress limit')
    const response = await fetch(url)
    if (!response.ok) throw new Error('Discord attachment download failed')
    const data = new Uint8Array(await response.arrayBuffer())
    if (data.byteLength !== declaredSize || data.byteLength > 25 * 1024 * 1024) {
      throw new Error('Discord attachment size mismatch')
    }
    return data
  }
}

function stripBotMention(content: string, botId: string): string {
  return content.replace(new RegExp(`<@!?${botId}>`, 'g'), '').trim()
}

function discordErrorDetails(error: unknown): {
  code?: unknown
  status?: unknown
  causeStatus?: unknown
  summary: string
} {
  const record = typeof error === 'object' && error !== null ? error as Record<string, unknown> : undefined
  const cause = typeof record?.cause === 'object' && record.cause !== null
    ? record.cause as Record<string, unknown>
    : undefined
  const safe = (value: unknown): string | undefined => {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined
    const text = String(value)
    return /^[A-Za-z0-9_.-]{1,80}$/.test(text) ? text : undefined
  }
  const markers = [
    safe(record?.name) === undefined ? undefined : `name=${safe(record?.name)}`,
    safe(record?.code) === undefined ? undefined : `code=${safe(record?.code)}`,
    safe(record?.status) === undefined ? undefined : `status=${safe(record?.status)}`,
    safe(cause?.code) === undefined ? undefined : `causeCode=${safe(cause?.code)}`,
    safe(cause?.status) === undefined ? undefined : `causeStatus=${safe(cause?.status)}`,
  ].filter((value): value is string => value !== undefined)
  return {
    code: record?.code,
    status: record?.status,
    causeStatus: cause?.status,
    summary: markers.join(', ') || 'unclassified',
  }
}
