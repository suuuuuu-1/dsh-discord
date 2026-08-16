import('../lib/index.js').then((module) => {
  if (module.name !== 'dsh-discord' || typeof module.apply !== 'function') process.exit(1)
  const config = module.Config({})
  if (config.tokenRef !== 'DSH_DISCORD_BOT_TOKEN' || config.statePath !== 'state.json') process.exit(1)
  process.stdout.write('built import smoke passed\n')
})
