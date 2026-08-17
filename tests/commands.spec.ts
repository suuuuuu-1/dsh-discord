import { describe, expect, it } from 'vitest'
import { DSH_COMMAND_BODY } from '../src/discord/commands.js'

describe('Discord commands', () => {
  it('publishes the discoverable help subcommand', () => {
    expect(DSH_COMMAND_BODY.options?.map(option => option.name)).toContain('help')
  })
})
