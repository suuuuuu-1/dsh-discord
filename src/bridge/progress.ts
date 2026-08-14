import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { DiscordSentMessage, DiscordTransport } from '../discord/types.js'
import { assistantText, finalPayload, statusPayload } from './renderer.js'

/** Coalesced presentation for one whole-Agent activity interval. */
export class ProgressReporter {
  private message: DiscordSentMessage | undefined
  private timer: NodeJS.Timeout | undefined
  private dirtyText = ''
  private finalText = ''
  private status: 'running' | 'cancelled' | 'failed' = 'running'
  private closed = false

  constructor(private readonly transport: DiscordTransport, private readonly intervalMs: number) {}

  async begin(channelId: string): Promise<void> {
    this.message = await this.transport.send(channelId, statusPayload('⏳ DeepSeek Harness 正在运行…'))
  }

  observe(event: SessionEvent): void {
    if (this.closed) return
    if (event.type === 'tool/call') {
      this.queue(`🔧 正在使用工具：${event.data.name}`)
    } else if (event.type === 'assistant/message') {
      const text = assistantText(event)
      if (text.length > 0) {
        this.finalText = text
        this.queue(`⏳ 正在整理结果…\n\n${text.slice(0, 1200)}`)
      }
    } else if (event.type === 'turn/end') {
      if (event.data.reason.kind === 'error') this.status = 'failed'
      else if (event.data.reason.kind === 'aborted') this.status = 'cancelled'
    }
  }

  queued(steering: boolean): void {
    this.queue(steering ? '🧭 已将引导排入当前任务最近的步骤。' : '📥 Agent 正在运行；消息已排入下一轮。')
  }

  async complete(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    if (this.message === undefined) return
    await this.transport.edit(this.message, finalPayload(
      this.finalText,
      this.status === 'running' ? 'completed' : this.status,
    ))
  }

  async cancel(): Promise<void> {
    this.status = 'cancelled'
    await this.complete()
  }

  private queue(text: string): void {
    this.dirtyText = text
    if (this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      const message = this.message
      const content = this.dirtyText
      if (this.closed || message === undefined || content.length === 0) return
      void this.transport.edit(message, statusPayload(content)).catch(() => undefined)
    }, this.intervalMs)
  }
}
