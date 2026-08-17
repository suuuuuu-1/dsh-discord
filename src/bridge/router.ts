import type { DiscordEventHandler, DiscordInboundEvent, DiscordInteractionResponse, DiscordTransport } from '../discord/types.js'
import type { SecurityPolicy } from '../security/policy.js'
import type { StateStore } from '../state/store.js'
import { DiscordInputError, type AgentController } from './agent-controller.js'
import type { ApprovalInteraction } from '../interaction/approval.js'
import type { QuestionInteraction } from '../interaction/questions.js'

/** Authenticated, deduplicated inbound dispatcher for Discord conversations. */
export class BridgeRouter implements DiscordEventHandler {
  constructor(
    private readonly transport: DiscordTransport,
    private readonly policy: SecurityPolicy,
    private readonly state: StateStore,
    private readonly controller: AgentController,
    private readonly approvals: ApprovalInteraction,
    private readonly questions: QuestionInteraction,
  ) {}

  async handle(event: DiscordInboundEvent): Promise<DiscordInteractionResponse | void> {
    const denial = this.policy.authorize(event)
    if (denial === '未授权用户。' && event.guildId !== undefined) return
    if (denial !== undefined) return event.kind === 'message' ? this.send(event.channelId, denial) : { kind: 'reply', content: denial }
    if (event.kind === 'message' && !this.shouldTrigger(event)) return
    if (!await this.state.claimEvent(event.eventId)) {
      return event.kind === 'message' ? undefined : { kind: 'reply', content: '该事件已处理。' }
    }
    await this.state.touchConversation({
      channelId: event.channelId,
      kind: event.contextKind,
      ...(event.guildId === undefined ? {} : { guildId: event.guildId }),
    })
    if (event.kind === 'component') {
      return this.approvals.handle(event) ?? this.questions.handle(event)
        ?? { kind: 'reply', content: '该交互不存在或已过期。' }
    }
    if (event.kind === 'command') return this.handleCommand(event.command, event.channelId, event.text)
    const textual = event.attachments.length === 0 ? parseTextCommand(event.text) : undefined
    if (textual !== undefined) return this.handleCommand(textual.command, event.channelId, textual.text)
    try {
      await this.controller.submit(event.text, event.channelId, false, event.attachments)
    } catch (error) {
      await this.send(event.channelId, error instanceof DiscordInputError
        ? error.message
        : '无法启动任务。请运行 dsh-discord doctor 检查配置。')
    }
  }

  private async handleCommand(
    command: 'help' | 'status' | 'new' | 'stop' | 'steer', channelId: string, text?: string,
  ): Promise<DiscordInteractionResponse> {
    try {
      if (command === 'help') return { kind: 'reply', content: HELP_TEXT }
      if (command === 'status') return { kind: 'reply', content: this.controller.status(channelId) }
      if (command === 'new') {
        const id = await this.controller.newSession(channelId)
        return { kind: 'reply', content: `已创建新 Session：${id}` }
      }
      if (command === 'stop') {
        const stopped = await this.controller.stop(channelId)
        return { kind: 'reply', content: stopped ? '已请求停止当前任务。' : '当前没有运行中的任务。' }
      }
      if (text?.trim()) {
        await this.controller.submit(text, channelId, true)
        return { kind: 'reply', content: '已将引导排入当前任务最近的步骤。' }
      }
      return { kind: 'reply', content: '用法：/dsh steer <文本>' }
    } catch {
      return { kind: 'reply', content: '命令执行失败。请运行 dsh-discord doctor 检查配置。' }
    }
  }

  private async send(channelId: string, content: string): Promise<void> {
    await this.transport.send(channelId, { content })
  }

  private shouldTrigger(event: Extract<DiscordInboundEvent, { kind: 'message' }>): boolean {
    if (event.contextKind === 'dm') return true
    if (event.contextKind === 'channel') return event.mentionsBot === true
    return event.mentionsBot === true
      || this.state.conversation(event.channelId)?.sessionId !== undefined
      || this.controller.hasSession(event.channelId)
  }
}

/** Parse textual fallbacks for clients that do not expose global commands yet. */
export function parseTextCommand(text: string): { command: 'help' | 'status' | 'new' | 'stop' | 'steer'; text?: string } | undefined {
  const match = /^\/dsh\s+(help|status|new|stop|steer)(?:\s+([\s\S]+))?\s*$/.exec(text.trim())
  if (match === null) return undefined
  const command = match[1] as 'help' | 'status' | 'new' | 'stop' | 'steer'
  return match[2] === undefined ? { command } : { command, text: match[2] }
}

const HELP_TEXT = [
  '**dsh-discord 命令**',
  '`/dsh status` 查看当前 Session 和 Agent 状态',
  '`/dsh new` 创建并绑定新 Session',
  '`/dsh stop` 停止当前任务',
  '`/dsh steer <文本>` 引导当前任务最近的步骤',
  '',
  'DM 普通消息会直接提交；Guild 文字频道首次消息需要 @Bot；已绑定的 Thread 可直接继续对话。',
].join('\n')
