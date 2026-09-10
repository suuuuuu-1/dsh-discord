/**
 * Static provider/model catalog for the /model command.
 *
 * v1 mirrors the provider routes known to the `discord` profile:
 * the `deepseek-official` built-ins and the local Ollama bridge models in
 * ~/.dsh/settings.yaml (`llm-pi-ai.providers.ollama`). Keep the lists here in
 * sync with those sources and the dsh runtime's registered provider routes.
 */

export interface CatalogModel {
  id: string
  label: string
}

export interface ProviderEntry {
  provider: string
  providerLabel: string
  models: CatalogModel[]
}

const OLLAMA_LABELS: Array<[string, string]> = [
  ['glm-5.2:cloud', 'GLM 5.2 (cloud)'],
  ['glm-5.3:cloud', 'GLM 5.3 (cloud)'],
  ['glm-5.3-flash:cloud', 'GLM 5.3 Flash (cloud)'],
  ['glm-5.1:cloud', 'GLM 5.1 (cloud)'],
  ['kimi-k3:cloud', 'Kimi K3 (cloud)'],
  ['kimi-k2.7-code:cloud', 'Kimi K2.7 Code (cloud)'],
  ['kimi-k2.6:cloud', 'Kimi K2.6 (cloud)'],
  ['minimax-m3:cloud', 'MiniMax M3 (cloud)'],
  ['minimax-m2.5:cloud', 'MiniMax M2.5 (cloud)'],
  ['deepseek-v4-pro:cloud', 'DeepSeek V4 Pro (cloud)'],
  ['deepseek-v4-flash:cloud', 'DeepSeek V4 Flash (cloud)'],
  ['qwen3.5:9b', 'Qwen 3.5 9B (local)'],
  ['deepseek-r1:8b', 'DeepSeek R1 8B (local)'],
  ['gemma4:e4b', 'Gemma 4 E4B (local)'],
  ['gemma3:4b', 'Gemma 3 4B (local)'],
  ['gemma3:1b-it-qat', 'Gemma 3 1B QAT (local)'],
  ['qwen2.5vl:latest', 'Qwen 2.5 VL (local, vision)'],
  ['llava:latest', 'LLaVA (local, vision)'],
]

const PROVIDERS: ProviderEntry[] = [
  {
    provider: 'deepseek-official',
    providerLabel: 'DeepSeek (官方)',
    models: [
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
      { id: 'deepseek-v4-flash-vision-exp', label: 'DeepSeek V4 Flash Vision' },
    ],
  },
  {
    provider: 'ollama',
    providerLabel: 'Ollama (local)',
    models: OLLAMA_LABELS.map(([id, label]) => ({ id, label })),
  },
]

/** Current provider/model catalog for the /model command. */
export function catalog(): ProviderEntry[] {
  return PROVIDERS
}

function providerEntry(provider: string): ProviderEntry | undefined {
  return PROVIDERS.find(entry => entry.provider === provider)
}

function modelEntry(provider: string, model: string): CatalogModel | undefined {
  return providerEntry(provider)?.models.find(item => item.id === model)
}

/** Human label for one provider/model selection. */
export function describe(next: { provider: string; model: string }): string {
  const model = modelEntry(next.provider, next.model)
  return model === undefined ? `${next.provider}/${next.model}` : `${next.provider}/${next.model}（${model.label}）`
}

const PROVIDER_FORM = 'provider/model（例如 deepseek-official/deepseek-v4-flash）'

/** Parse and strictly validate a `provider/model` spec against the catalog. */
export function resolveModelSpec(spec: string): { provider: string; model: string } {
  const trimmed = spec.trim()
  const slash = trimmed.lastIndexOf('/')
  if (slash <= 0 || slash === trimmed.length - 1) {
    throw new Error(`无法识别的模型格式「${trimmed}」。请使用 ${PROVIDER_FORM}。`)
  }
  const provider = trimmed.slice(0, slash)
  const model = trimmed.slice(slash + 1)
  const entry = providerEntry(provider)
  if (entry === undefined) {
    const providers = PROVIDERS.map(item => item.provider).join('、')
    throw new Error(`未知的提供商「${provider}」。可用提供商：${providers}。请使用 ${PROVIDER_FORM}。`)
  }
  if (modelEntry(provider, model) === undefined) {
    const models = entry.models.map(item => item.id).join('、')
    throw new Error(`提供商「${provider}」下没有模型「${model}」。可用模型：${models}。`)
  }
  return { provider, model }
}

/** Multi-line human listing of every catalog provider and model. */
export function listText(): string {
  const lines = ['**可用提供商与模型**', '']
  for (const entry of PROVIDERS) {
    lines.push(`**${entry.providerLabel}**（\`${entry.provider}\`）`)
    for (const model of entry.models) lines.push(`- \`${model.id}\`：${model.label}`)
    lines.push('')
  }
  lines.push(`切换：\`/model set ${PROVIDER_FORM}\``)
  return lines.join('\n').trimEnd()
}
