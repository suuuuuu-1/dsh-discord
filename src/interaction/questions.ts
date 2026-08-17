import { randomUUID } from 'node:crypto'
import type {
  AskUserQuestionAnswer,
  AskUserQuestionAnswerItem,
  AskUserQuestionItem,
  AskUserQuestionRequest,
  UserQuestionProvider,
} from '@deepseek-ai/dsh-user-questions'
import type { DiscordInboundEvent, DiscordInteractionResponse, DiscordSentMessage, DiscordTransport } from '../discord/types.js'
import type { AgentController } from '../bridge/agent-controller.js'
import { boundedDiscordText, suppressMentions } from '../bridge/renderer.js'

interface PendingQuestion {
  question: AskUserQuestionItem
  resolve(answer: AskUserQuestionAnswerItem): void
  reject(error: Error): void
  timer: NodeJS.Timeout
  message?: DiscordSentMessage
}

/** Discord provider for DSH structured user questions. */
export class QuestionInteraction implements UserQuestionProvider {
  private readonly pending = new Map<string, PendingQuestion>()
  private closed = false

  constructor(
    private readonly transport: DiscordTransport,
    private readonly controller: AgentController,
    private readonly timeoutMs: number,
  ) {}

  async ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
    if (this.closed) throw new Error('Discord question provider is shutting down')
    if (request.agent !== undefined && !this.controller.owns(request.agent)) {
      throw new Error('Discord question provider does not own this Agent')
    }
    const channelId = this.controller.currentChannel(request.agent)
    if (channelId === undefined) throw new Error('No Discord conversation is bound to this Agent')
    const answers: AskUserQuestionAnswerItem[] = []
    for (const question of request.questions) {
      answers.push(await this.askOne(channelId, question, request.signal))
    }
    return { answers }
  }

  handle(event: DiscordInboundEvent): DiscordInteractionResponse | undefined {
    if (event.kind !== 'component') return undefined
    const match = /^dsh:q:([^:]+):(select|custom|modal)$/.exec(event.customId)
    if (match === null) return undefined
    const nonce = match[1]!
    const pending = this.pending.get(nonce)
    if (pending === undefined) return { kind: 'reply', content: '该问题不存在或已过期。' }
    const action = match[2]
    if (action === 'custom') {
      return { kind: 'modal', customId: `dsh:q:${nonce}:modal`, title: '回答 DSH 问题', label: '自定义回答' }
    }
    if (action === 'modal') {
      const custom = event.text?.trim()
      if (custom === undefined || custom.length === 0) return { kind: 'reply', content: '回答不能为空。' }
      this.settle(nonce, { id: pending.question.id, selected: [], custom }, '✅ 已记录自定义回答。')
      return { kind: 'reply', content: '✅ 已记录回答。' }
    }
    const options = pending.question.options ?? []
    const indexes = event.values ?? []
    const selected = indexes.flatMap(value => {
      const option = options[Number(value)]
      return option === undefined ? [] : [option.label]
    })
    if (selected.length === 0) return { kind: 'reply', content: '请选择至少一项。' }
    this.settle(nonce, { id: pending.question.id, selected }, '✅ 已记录回答。')
    return { kind: 'update', content: '✅ 已记录回答。' }
  }

  dispose(): void {
    this.closed = true
    for (const [nonce, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Discord question provider was disposed'))
      this.pending.delete(nonce)
      if (pending.message !== undefined) {
        void this.transport.edit(pending.message, { content: '⏹️ 插件已卸载，问题已取消。' }).catch(() => undefined)
      }
    }
  }

  private askOne(channelId: string, question: AskUserQuestionItem, signal?: AbortSignal): Promise<AskUserQuestionAnswerItem> {
    if (signal?.aborted) return Promise.reject(new Error('Question was aborted'))
    const nonce = randomUUID()
    const options = question.options ?? []
    const selectable = options.length > 0 && options.length <= 25
    const heading = question.header === undefined ? '' : `**${suppressMentions(question.header)}**\n`
    const detail = question.detail === undefined ? '' : `\n\n${suppressMentions(question.detail)}`
    return new Promise<AskUserQuestionAnswerItem>((resolve, reject) => {
      const pending: PendingQuestion = {
        question,
        resolve,
        reject,
        timer: setTimeout(() => this.expire(nonce, '问题等待超时'), this.timeoutMs),
      }
      this.pending.set(nonce, pending)
      void this.transport.send(channelId, {
        content: boundedDiscordText(`❓ ${heading}${suppressMentions(question.question)}${detail}`),
        ...!selectable ? {} : { select: {
          customId: `dsh:q:${nonce}:select`, placeholder: question.multiSelect ? '可多选' : '请选择',
          options: options.map((option, index) => ({
            label: suppressMentions(option.label),
            ...(option.description === undefined ? {} : { description: suppressMentions(option.description) }),
            value: String(index),
          })),
          minValues: 1,
          maxValues: question.multiSelect ? options.length : 1,
        } },
        buttons: [{ customId: `dsh:q:${nonce}:custom`, label: '自定义回答', style: 'secondary' }],
      }).then(message => { pending.message = message }, () => this.expire(nonce, '无法发送问题'))
      signal?.addEventListener('abort', () => this.expire(nonce, '问题已取消'), { once: true })
    })
  }

  private settle(nonce: string, answer: AskUserQuestionAnswerItem, content: string): void {
    const pending = this.pending.get(nonce)
    if (pending === undefined) return
    this.pending.delete(nonce)
    clearTimeout(pending.timer)
    pending.resolve(answer)
    if (pending.message !== undefined) void this.transport.edit(pending.message, { content }).catch(() => undefined)
  }

  private expire(nonce: string, reason: string): void {
    const pending = this.pending.get(nonce)
    if (pending === undefined) return
    this.pending.delete(nonce)
    clearTimeout(pending.timer)
    pending.reject(new Error(reason))
    if (pending.message !== undefined) void this.transport.edit(pending.message, { content: `⌛ ${reason}。` }).catch(() => undefined)
  }
}
