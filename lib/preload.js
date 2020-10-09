'use strict'
const { createRequire } = require('module')
const { LAZARETTO_OVERRIDES } = process.env
const { entry, g, b, l } = LAZARETTO_OVERRIDES ? JSON.parse(LAZARETTO_OVERRIDES) : {}
const createInclude = require('./include')

preloader().catch((err) => {
  console.error('lazaretto cjs preloader error', err)
  process.kill(1)
})

async function preloader () {
  const { parentPort, workerData: { context } } = await import('worker_threads')
  const set = (o, p, v) => {
    o[p] = v
    parentPort.postMessage(['context', o])
    return v
  }
  global[Symbol.for('kLazarettoContext')] = new Proxy(context, { set })

  if (!LAZARETTO_OVERRIDES) return

  const include = createInclude(entry)
  const entryRequire = createRequire(entry)
  for (const [name, override] of Object.entries(g)) {
    const mock = Function('...args', `return (${override})(...args)`) // eslint-disable-line
    global[name] = await mock(global[name], { context: global[Symbol.for('kLazarettoContext')], include })
  }

  for (const [name, override] of Object.entries(b)) {
    const mock = Function('...args', `return (${override})(...args)`) // eslint-disable-line
    require.cache[name] = {
      exports: await mock(require(name), { context: global[Symbol.for('kLazarettoContext')], include })
    }
    // process is a special case where its both a builtin and a global
    if (name === 'process') global[name] = require.cache[name].exports
  }

  for (const [name, override] of Object.entries(l)) {
    const mock = Function('...args', `return (${override})(...args)`) // eslint-disable-line
    entryRequire(name) // load the cache
    const mod = require.cache[entryRequire.resolve(name)]
    mod.exports = await mock(mod.exports, { context: global[Symbol.for('kLazarettoContext')], include })
  }
}
