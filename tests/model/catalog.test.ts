import { describe, expect, it } from 'vitest'
import { catalog, describe as describeSpec, listText, resolveModelSpec } from '../../src/model/catalog.js'

describe('model catalog', () => {
  it('exposes the deepseek-official and ollama provider entries', () => {
    const entries = catalog()
    expect(entries.map(entry => entry.provider)).toEqual(['deepseek-official', 'ollama'])
    const deepseek = entries.find(entry => entry.provider === 'deepseek-official')
    expect(deepseek?.models.map(model => model.id)).toEqual([
      'deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4-flash-vision-exp',
    ])
    const ollama = entries.find(entry => entry.provider === 'ollama')
    expect(ollama?.models.map(model => model.id)).toContain('glm-5.2:cloud')
    expect(ollama?.models.map(model => model.id)).toContain('qwen2.5vl:latest')
    expect(ollama?.models.map(model => model.id)).toContain('llava:latest')
  })

  it('parses a known provider/model spec', () => {
    expect(resolveModelSpec('deepseek-official/deepseek-v4-flash'))
      .toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    expect(resolveModelSpec('ollama/glm-5.2:cloud')).toEqual({ provider: 'ollama', model: 'glm-5.2:cloud' })
    expect(resolveModelSpec('  deepseek-official/deepseek-v4-pro  '))
      .toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
  })

  it('rejects a bare model without a provider', () => {
    expect(() => resolveModelSpec('glm-5.2:cloud')).toThrow(/provider\/model/)
    expect(() => resolveModelSpec('deepseek-v4-flash')).toThrow(/provider\/model/)
  })

  it('rejects an unknown provider with the available providers listed', () => {
    expect(() => resolveModelSpec('acme/deepseek-v4-flash'))
      .toThrow(/未知的提供商「acme」[\s\S]*deepseek-official[\s\S]*ollama/)
  })

  it('rejects an unknown model with the available models listed', () => {
    expect(() => resolveModelSpec('deepseek-official/deepseek-v4-ultra'))
      .toThrow(/提供商「deepseek-official」下没有模型「deepseek-v4-ultra」[\s\S]*deepseek-v4-flash/)
  })

  it('describes known selections with a human label and falls back to the raw spec', () => {
    expect(describeSpec({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }))
      .toContain('DeepSeek V4 Flash')
    expect(describeSpec({ provider: 'ollama', model: 'glm-5.2:cloud' })).toContain('GLM 5.2 (cloud)')
    expect(describeSpec({ provider: 'acme', model: 'deepseek-v4-flash' })).toBe('acme/deepseek-v4-flash')
  })

  it('formats a readable listing with every provider and the set usage', () => {
    const text = listText()
    expect(text).toContain('**可用提供商与模型**')
    expect(text).toContain('deepseek-official')
    expect(text).toContain('ollama')
    expect(text).toContain('glm-5.2:cloud')
    expect(text).toContain('deepseek-v4-pro')
    expect(text).toContain('/model set provider/model')
  })
})
