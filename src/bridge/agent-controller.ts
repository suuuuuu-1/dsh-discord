import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type Agent, type AgentHandle, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-attachment'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { DiscordInboundAttachment, DiscordTransport } from '../discord/types.js'
import type { StateStore } from '../state/store.js'
import { ProgressReporter } from './progress.js'

const MAX_TEXT_ATTACHMENT_BYTES = 512 * 1024
const MAX_TEXT_ATTACHMENTS_BYTES = 1024 * 1024

interface ConversationRuntime {
  readonly channelId: string
  handle: AgentHandle | undefined
  opening: Promise<Agent> | undefined
  progress: ProgressReporter | undefined
  settling: Promise<void> | undefined
  delivery: Promise<void>
  pendingDeliveries: number
  generation: number
}

/** Safe input refusal whose message may be shown back to the Discord owner. */
export class DiscordInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DiscordInputError'
  }
}

/** Owns one live Agent and progress presenter per Discord conversation. */
export class AgentController {
  private readonly runtimes = new Map<string, ConversationRuntime>()
  private disposed = false

  constructor(
    private readonly ctx: Context,
    private readonly projectRoot: string,
    private readonly state: StateStore,
    private readonly transport: DiscordTransport,
    private readonly progressIntervalMs: number,
  ) {}

  status(channelId: string): string {
    const runtime = this.runtimes.get(channelId)
    const agent = runtime?.handle?.agent
    if (agent === undefined) {
      const persisted = this.state.conversation(channelId)?.sessionId
      return persisted === undefined ? '当前频道没有 Session。' : `Session ${persisted} 尚未恢复。`
    }
    return `Session: ${agent.id}\n状态: ${agent.status === 'running' ? '运行中' : '空闲'}`
  }

  /** Whether a persisted, live, or currently opening Session owns this conversation. */
  hasSession(channelId: string): boolean {
    if (this.state.conversation(channelId)?.sessionId !== undefined) return true
    const runtime = this.runtimes.get(channelId)
    return runtime !== undefined
      && (runtime.handle !== undefined || runtime.opening !== undefined || runtime.pendingDeliveries > 0)
  }

  async submit(
    text: string,
    channelId: string,
    steering = false,
    attachments: readonly DiscordInboundAttachment[] = [],
  ): Promise<void> {
    const runtime = this.runtime(channelId)
    runtime.pendingDeliveries += 1
    let content: ContentBlock[]
    try {
      content = await this.content(text, attachments)
    } catch (error) {
      runtime.pendingDeliveries -= 1
      throw error
    }
    const operation = runtime.delivery.then(() => this.deliver(runtime, content, steering))
    runtime.delivery = operation.catch(() => undefined)
    try {
      await operation
    } finally {
      runtime.pendingDeliveries -= 1
    }
  }

  private async deliver(runtime: ConversationRuntime, content: ContentBlock[], steering: boolean): Promise<void> {
    const agent = await this.ensureAgent(runtime)
    if (runtime.progress === undefined) {
      const progress = new ProgressReporter(this.transport, this.progressIntervalMs)
      runtime.progress = progress
      try {
        await progress.begin(runtime.channelId)
      } catch (error) {
        if (runtime.progress === progress) runtime.progress = undefined
        throw error
      }
    } else {
      runtime.progress.queued(steering)
    }
    const message = createUserMessage({ content, source: { kind: 'user' } })
    if (steering) agent.steer(message)
    else agent.followup(message)
    runtime.generation += 1
    // Discord messages may be deleted or become unavailable while a turn is
    // settling. Keep that presentation failure from becoming an unhandled
    // rejection or poisoning the next queued followup.
    runtime.settling ??= this.settle(runtime, agent).catch(() => undefined)
  }

  async newSession(channelId: string): Promise<string> {
    const runtime = this.runtime(channelId)
    await this.release(runtime)
    await this.state.setSessionId(channelId, undefined)
    const agent = await this.createAgent(runtime)
    return String(agent.id)
  }

  async stop(channelId: string): Promise<boolean> {
    const agent = this.runtimes.get(channelId)?.handle?.agent
    if (agent === undefined || agent.status === 'idle') return false
    agent.cancel({ kind: 'user' })
    return true
  }

  observe(session: { id: unknown }, event: SessionEvent): void {
    for (const runtime of this.runtimes.values()) {
      const agent = runtime.handle?.agent
      if (agent?.session === session) {
        runtime.progress?.observe(event)
        return
      }
    }
  }

  owns(agent: Agent): boolean {
    return this.currentChannel(agent) !== undefined
  }

  currentChannel(agent?: Agent): string | undefined {
    if (agent === undefined) {
      const active = [...this.runtimes.values()].filter(runtime => runtime.handle !== undefined)
      return active.length === 1 ? active[0]?.channelId : undefined
    }
    for (const runtime of this.runtimes.values()) {
      if (runtime.handle?.agent === agent) return runtime.channelId
    }
    return undefined
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    const runtimes = [...this.runtimes.values()]
    this.runtimes.clear()
    await Promise.all(runtimes.map(async runtime => {
      runtime.handle?.agent.cancel({ kind: 'disposed' })
      await runtime.progress?.cancel().catch(() => undefined)
      await this.release(runtime)
    }))
  }

  private runtime(channelId: string): ConversationRuntime {
    let runtime = this.runtimes.get(channelId)
    if (runtime === undefined) {
      runtime = {
        channelId,
        handle: undefined,
        opening: undefined,
        progress: undefined,
        settling: undefined,
        delivery: Promise.resolve(),
        pendingDeliveries: 0,
        generation: 0,
      }
      this.runtimes.set(channelId, runtime)
    }
    return runtime
  }

  private async ensureAgent(runtime: ConversationRuntime): Promise<Agent> {
    if (this.disposed) throw new Error('Discord bridge is shutting down')
    if (runtime.handle !== undefined) return runtime.handle.agent
    runtime.opening ??= this.openAgent(runtime)
    try {
      return await runtime.opening
    } finally {
      runtime.opening = undefined
    }
  }

  private async openAgent(runtime: ConversationRuntime): Promise<Agent> {
    const persisted = this.state.conversation(runtime.channelId)?.sessionId
    if (persisted === undefined) return this.createAgent(runtime)
    runtime.handle = await this.ctx.agents.resume({
      resumeSessionId: SessionId(persisted),
      agentOptions: this.agentOptions(),
      setup: agentCtx => this.setupSelection(agentCtx),
    })
    await runtime.handle.agent.whenIdle()
    return runtime.handle.agent
  }

  private async createAgent(runtime: ConversationRuntime): Promise<Agent> {
    const sessionId = SessionId(`discord-${randomUUID()}`)
    runtime.handle = await this.ctx.agents.create({
      sessionId,
      meta: { cwd: this.projectRoot },
      agentOptions: this.agentOptions(),
      setup: agentCtx => this.setupSelection(agentCtx),
    })
    await runtime.handle.agent.whenIdle()
    await this.state.setSessionId(runtime.channelId, String(sessionId))
    return runtime.handle.agent
  }

  private selection() {
    return this.ctx.agentDefaultModel.currentSelection()
  }

  private agentOptions() {
    const selection = this.selection()
    return { provider: selection.provider, model: selection.model }
  }

  private setupSelection(agentCtx: Context): void {
    const selected: ModelSelectionRef = { current: this.selection(), assembled: undefined }
    installModelSelection(agentCtx, selected)
  }

  private async settle(runtime: ConversationRuntime, agent: Agent): Promise<void> {
    try {
      while (runtime.handle?.agent === agent) {
        const generation = runtime.generation
        await agent.whenIdle()
        if (runtime.generation !== generation || agent.status !== 'idle') continue
        await this.ctx.sessions.flush(agent.session)
        if (runtime.generation !== generation || agent.status !== 'idle') continue
        const progress = runtime.progress
        runtime.progress = undefined
        await progress?.complete()
        if (runtime.generation === generation && agent.status === 'idle') return
      }
    } finally {
      runtime.settling = undefined
    }
  }

  private async release(runtime: ConversationRuntime): Promise<void> {
    await runtime.delivery.catch(() => undefined)
    if (runtime.opening !== undefined) await runtime.opening.catch(() => undefined)
    const handle = runtime.handle
    runtime.handle = undefined
    handle?.agent.cancel({ kind: 'disposed' })
    if (runtime.settling !== undefined) await runtime.settling.catch(() => undefined)
    await handle?.dispose()
  }

  private async content(text: string, attachments: readonly DiscordInboundAttachment[]): Promise<ContentBlock[]> {
    const trimmed = text.trim()
    if (trimmed.length === 0 && attachments.length === 0) throw new DiscordInputError('消息和附件不能同时为空。')
    const content: ContentBlock[] = trimmed.length === 0 ? [] : [{ type: 'text', text: trimmed }]
    const images = attachments.filter(item => isImageMediaType(item.mediaType))
    const other = attachments.filter(item => !isImageMediaType(item.mediaType))
    const limits = this.ctx.attachments.imageLimits
    if (images.length > limits.maxImagesPerMessage) throw new DiscordInputError('图片数量超过 DSH 当前限制。')
    if (images.reduce((sum, item) => sum + item.size, 0) > limits.maxMessageImageBytes) {
      throw new DiscordInputError('图片总大小超过 DSH 当前限制。')
    }
    const imageInputs = await Promise.all(images.map(async item => ({
      data: await this.readAttachment(item),
      mediaType: item.mediaType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
      name: item.name,
    })))
    await Promise.all(imageInputs.map(input => this.ctx.attachments.validateImage(input)))
    for (const input of imageInputs) {
      content.push({ type: 'image', attachment: await this.ctx.attachments.saveImage(input) })
    }
    let textBytes = 0
    for (const attachment of other) {
      if (!isTextAttachment(attachment)) {
        throw new DiscordInputError(`暂不支持二进制附件：${attachment.name}；当前支持图片、文本和代码文件。`)
      }
      if (attachment.size > MAX_TEXT_ATTACHMENT_BYTES) {
        throw new DiscordInputError(`文本附件过大：${attachment.name}。`)
      }
      textBytes += attachment.size
      if (textBytes > MAX_TEXT_ATTACHMENTS_BYTES) throw new DiscordInputError('文本附件总大小超过 1 MiB。')
      let decoded: string
      try {
        decoded = new TextDecoder('utf-8', { fatal: true }).decode(await this.readAttachment(attachment))
      } catch {
        throw new DiscordInputError(`附件不是有效 UTF-8 文本：${attachment.name}。`)
      }
      content.push({ type: 'text', text: `\n\n<discord-attachment name=${JSON.stringify(attachment.name)}>\n${decoded}\n</discord-attachment>` })
    }
    return content
  }

  private async readAttachment(attachment: DiscordInboundAttachment): Promise<Uint8Array> {
    try {
      const data = await attachment.read()
      if (data.byteLength !== attachment.size) throw new Error('size mismatch')
      return data
    } catch {
      throw new DiscordInputError(`无法读取 Discord 附件：${attachment.name}。`)
    }
  }
}

function isImageMediaType(value: string | undefined): boolean {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' || value === 'image/gif'
}

function isTextAttachment(attachment: DiscordInboundAttachment): boolean {
  if (attachment.mediaType?.startsWith('text/') === true) return true
  if (attachment.mediaType !== undefined && [
    'application/json', 'application/xml', 'application/javascript', 'application/x-yaml',
  ].includes(attachment.mediaType)) return true
  return /\.(?:txt|md|markdown|json|jsonl|ya?ml|toml|xml|csv|tsv|log|js|jsx|mjs|cjs|ts|tsx|css|scss|html|py|go|rs|java|kt|c|cc|cpp|h|hpp|cs|php|rb|sh|ps1|sql|graphql|vue|svelte)$/i.test(attachment.name)
}
