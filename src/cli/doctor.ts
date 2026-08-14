import { spawnSync } from 'node:child_process'

/** Boot the real profile in bounded diagnostic mode without printing the credential value. */
export function doctor(): void {
  const result = spawnSync('dsh', ['--profile', 'discord'], {
    stdio: 'inherit',
    env: { ...process.env, DSH_DISCORD_DOCTOR: '1' },
    shell: process.platform === 'win32',
    timeout: 45_000,
  })
  if (result.error !== undefined) {
    if ('code' in result.error && result.error.code === 'ETIMEDOUT') {
      throw new Error('诊断超时：Discord Gateway 在 45 秒内没有完成连接。')
    }
    throw new Error('无法运行 dsh；请先安装 DeepSeek Harness。')
  }
  if (result.status !== 0) throw new Error('诊断未通过。')
}
