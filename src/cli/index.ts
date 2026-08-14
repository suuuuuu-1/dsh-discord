#!/usr/bin/env node
import { Command } from 'commander'
import { setup } from './setup.js'
import { doctor } from './doctor.js'
import { daemonStatus, start, stopDaemon } from './start.js'

const program = new Command()
  .name('dsh-discord')
  .description('Bidirectional Discord bridge and remote controller for DeepSeek Harness')
  .version('0.1.0')

program.command('setup')
  .description('验证 Discord 并创建独立 discord profile')
  .option('--owner <id>', 'Discord Owner 用户 ID')
  .option('--project <path>', '唯一允许的项目目录')
  .option('--package-spec <spec>', '安装进 profile 的包规格（开发用途）')
  .action(async options => setup(options))

program.command('start')
  .description('启动独立 discord profile')
  .option('-d, --daemon', '在后台运行并记录 PID/日志')
  .action(async options => start(options))
program.command('stop').description('停止由 --daemon 启动的后台进程').action(stopDaemon)
program.command('status').description('查看后台进程和日志位置').action(daemonStatus)
program.command('doctor').description('诊断 DSH、凭据、项目、Gateway 与命令注册').action(doctor)

program.parseAsync().catch((error: unknown) => {
  process.stderr.write(`dsh-discord: ${error instanceof Error ? error.message : 'unexpected failure'}\n`)
  process.exitCode = 1
})
