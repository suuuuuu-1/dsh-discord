import { SlashCommandBuilder } from 'discord.js'

/** Global `/dsh` command definition for the personal controller. */
export const DSH_COMMAND = new SlashCommandBuilder()
  .setName('dsh')
  .setDescription('控制 DeepSeek Harness')
  .addSubcommand(command => command.setName('help').setDescription('查看消息触发规则和命令帮助'))
  .addSubcommand(command => command.setName('status').setDescription('查看当前 Agent 状态'))
  .addSubcommand(command => command.setName('new').setDescription('创建一个新 Session'))
  .addSubcommand(command => command.setName('stop').setDescription('停止当前任务'))
  .addSubcommand(command => command
    .setName('steer')
    .setDescription('将文本插入当前任务最近的步骤')
    .addStringOption(option => option.setName('text').setDescription('引导内容').setRequired(true)))

/** JSON body accepted by Discord's application-command REST endpoint. */
export const DSH_COMMAND_BODY = DSH_COMMAND.toJSON()
