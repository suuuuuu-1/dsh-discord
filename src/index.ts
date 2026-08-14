import { stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-session'
import { DiscordJsTransport } from './discord/client.js'
import type { DiscordTransport } from './discord/types.js'
import { SecurityPolicy } from './security/policy.js'
import { resolveStatePath, StateStore } from './state/store.js'
import { AgentController } from './bridge/agent-controller.js'
import { ApprovalInteraction } from './interaction/approval.js'
import { QuestionInteraction } from './interaction/questions.js'
import { BridgeRouter } from './bridge/router.js'

export { FakeDiscordTransport } from './discord/fake.js'
export type { DiscordTransport, DiscordInboundEvent } from './discord/types.js'
export { SecurityPolicy } from './security/policy.js'
export { StateStore } from './state/store.js'
export { BridgeRouter } from './bridge/router.js'

export const name = 'dsh-discord'
export const inject = ['agentDefaultModel', 'agents', 'attachments', 'credentials', 'sessions', 'userQuestions']

/** Cordis plugin configuration. Secret values never appear here; only their credential reference does. */
export interface Config {
  tokenRef: string
  ownerId?: string
  projectRoot?: string
  statePath: string
  setupMode?: boolean
  doctorMode?: boolean
  progressIntervalMs?: number
  interactionTimeoutMs?: number
  /** Runtime-only test injection, intentionally absent from the serialized schema. */
  transport?: DiscordTransport
}

export const Config: Schema<Config> = Schema.object({
  tokenRef: Schema.string().required(),
  ownerId: Schema.string(),
  projectRoot: Schema.string(),
  statePath: Schema.string().required(),
  setupMode: Schema.boolean().default(false),
  doctorMode: Schema.boolean().default(false),
  progressIntervalMs: Schema.number().min(100).default(1500),
  interactionTimeoutMs: Schema.number().min(1000).default(600000),
})

interface Runtime {
  dispose(): Promise<void>
}

/** Mount synchronously, then start the Discord protocol driver after the complete DSH composition settles. */
export function apply(ctx: Context, config: Config): void {
  const exit = ctx.get('appExit')
  let runtime: Runtime | undefined
  let disposed = false

  ctx.effect(() => () => {
    disposed = true
    const active = runtime
    runtime = undefined
    return active?.dispose()
  }, 'dsh-discord.lifecycle()')

  void boot().catch((error: unknown) => {
    if (disposed) return
    process.stderr.write(`${error instanceof Error ? error.message : 'dsh-discord: startup failed'}\n`)
    exit?.(1)
  })

  async function boot(): Promise<void> {
    // Loader siblings mount concurrently. Waiting outside apply avoids making
    // this plugin part of the settlement promise it is waiting for.
    await ctx.get('loader')?.await()
    if (disposed) return

  if (config.setupMode === true) {
    const token = process.env.DSH_DISCORD_SETUP_VALUE
    delete process.env.DSH_DISCORD_SETUP_VALUE
    if (token === undefined || token.length === 0) {
      process.stderr.write('dsh-discord: setup credential was not supplied\n')
      exit?.(1)
      return
    }
    try {
      await ctx.credentials.set(credentialRef(config.tokenRef), token)
      process.stdout.write('dsh-discord: Discord credential stored through ctx.credentials\n')
      exit?.(0)
    } catch {
      process.stderr.write(`dsh-discord: unable to store credential reference ${config.tokenRef}\n`)
      exit?.(1)
    }
    return
  }

  const policy = new SecurityPolicy(config)
  const configurationError = policy.configurationError()
  if (configurationError !== undefined) throw new Error(`dsh-discord: ${configurationError}`)
  if (policy.projectRoot !== undefined) {
    const info = await stat(policy.projectRoot).catch(() => undefined)
    if (info?.isDirectory() !== true) throw new Error(`dsh-discord: projectRoot is not an accessible directory: ${policy.projectRoot}`)
  }
  const resolved = await ctx.credentials.resolve(credentialRef(config.tokenRef))
  if (resolved === undefined) throw new Error(`dsh-discord: credential reference ${config.tokenRef} is not configured`)
  const transport = config.transport ?? new DiscordJsTransport()
  if (config.doctorMode === true) {
    await runDoctor(ctx, config, transport, resolved.value)
    exit?.(0)
    return
  }
  if (policy.projectRoot === undefined) {
    throw new Error('dsh-discord: projectRoot is required before the Discord transport can start')
  }
    const started = await startRuntime(ctx, config, policy, transport, resolved.value)
    if (disposed) {
      await started.dispose()
      return
    }
    runtime = started
  }
}

async function startRuntime(
  ctx: Context, config: Config, policy: SecurityPolicy, transport: DiscordTransport, token: string,
): Promise<Runtime> {
  const state = new StateStore(resolveStatePath(config.statePath))
  await state.load()
  const controller = new AgentController(
    ctx, policy.projectRoot!, state, transport, config.progressIntervalMs ?? 1500,
  )
  const approvals = new ApprovalInteraction(transport, controller, config.interactionTimeoutMs ?? 600000)
  const questions = new QuestionInteraction(transport, controller, config.interactionTimeoutMs ?? 600000)
  const router = new BridgeRouter(transport, policy, state, controller, approvals, questions)
  const unregisterQuestions = ctx.userQuestions.registerProvider(questions)
  const disposeSessionListener = ctx.on('session/event', (session, event) => controller.observe(session, event))
  const disposeApprovalListener = ctx.on('approval/request', (request, next) => approvals.request(request) ?? next())
  let started = false
  try {
    const identity = await transport.start(token, router)
    started = true
    await transport.registerCommands(identity.applicationId, token)
  } catch (error) {
    unregisterQuestions()
    disposeSessionListener()
    disposeApprovalListener()
    await transport.stop().catch(() => undefined)
    await state.close()
    throw error
  }
  return {
    async dispose() {
      approvals.dispose()
      questions.dispose()
      unregisterQuestions()
      disposeSessionListener()
      disposeApprovalListener()
      if (started) await transport.stop()
      await controller.dispose()
      await state.close()
    },
  }
}

async function runDoctor(ctx: Context, config: Config, transport: DiscordTransport, token: string): Promise<void> {
  process.stdout.write('✓ DSH services: agents, sessions, attachments, credentials, userQuestions\n')
  const info = await ctx.credentials.describe(credentialRef(config.tokenRef))
  process.stdout.write(`✓ Credential: configured from ${info.source ?? 'unknown source'}\n`)
  try {
    const identity = await transport.start(token, { handle: () => Promise.resolve() })
    process.stdout.write(`✓ Discord Gateway: connected as ${identity.username}\n`)
    await transport.registerCommands(identity.applicationId, token)
    process.stdout.write('✓ Discord commands: /dsh registered\n')
    const diagnostics = await transport.diagnose?.()
    if (diagnostics !== undefined) {
      if (diagnostics.guilds > 0 && diagnostics.writableChannels === 0) {
        throw new Error('Discord permission check failed: no text channel grants View/Send/History/Embed/Attach')
      }
      process.stdout.write(`✓ Discord guilds: ${String(diagnostics.guilds)}; writable text channels: ${String(diagnostics.writableChannels)}\n`)
    }
  } finally {
    await transport.stop().catch(() => undefined)
  }
  if (config.projectRoot !== undefined) process.stdout.write(`✓ Project directory: ${config.projectRoot}\n`)
}

export default { name, inject, Config, apply }
