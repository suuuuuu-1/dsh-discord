import('../lib/index.js').then((module) => {
  if (module.name !== 'dsh-discord' || typeof module.apply !== 'function') process.exit(1)
  process.stdout.write('built import smoke passed\n')
})
