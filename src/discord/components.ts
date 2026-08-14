import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js'
import type { DiscordButton, DiscordMessagePayload } from './types.js'

const BUTTON_STYLE = {
  primary: ButtonStyle.Primary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
  secondary: ButtonStyle.Secondary,
} as const

/** Convert transport-neutral controls to discord.js rows. */
export function componentRows(payload: DiscordMessagePayload): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = []
  const buttons = payload.buttons ?? []
  for (let start = 0; start < buttons.length; start += 5) {
    const row = new ActionRowBuilder<MessageActionRowComponentBuilder>()
    for (const button of buttons.slice(start, start + 5)) row.addComponents(discordButton(button))
    rows.push(row)
  }
  if (payload.select !== undefined) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(payload.select.customId)
      .setPlaceholder(payload.select.placeholder.slice(0, 150))
      .setMinValues(payload.select.minValues)
      .setMaxValues(payload.select.maxValues)
      .setDisabled(payload.select.disabled ?? false)
      .addOptions(payload.select.options.map(option => {
        const item = new StringSelectMenuOptionBuilder().setLabel(option.label.slice(0, 100)).setValue(option.value)
        if (option.description !== undefined) item.setDescription(option.description.slice(0, 100))
        return item
      }))
    rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select))
  }
  return rows
}

function discordButton(button: DiscordButton): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(button.customId)
    .setLabel(button.label.slice(0, 80))
    .setStyle(BUTTON_STYLE[button.style])
    .setDisabled(button.disabled ?? false)
}
