'use strict'
const { createRequire } = require('module')
const { LAZARETTO_OVERRIDES } = process.env
const { entry = process.cwd(), g = {}, b = {}, l = {} } = LAZARETTO_OVERRIDES ? JSON.parse(LAZARETTO_OVERRIDES) : {}
const createInclude = require('./include')
const context = require('./context')

const builtins = new Set(Object.keys(b))
const libraries = new Set(Object.keys(l))

module.exports = preload

preload().catch((err) => {
  console.error('lazaretto cjs preloader error', err)
  process.kill(1)
})

async function preload () {
  if (preload.result) return preload.result // avoid double run
  const mocks = {
    global: {},
    library: {},
    builtin: {}
  }
  global[Symbol.for('kLazarettoContext')] = await context()
  if (!LAZARETTO_OVERRIDES) return { mocks, entry, builtins, libraries }
  const entryRequire = createRequire(entry)
  const include = createInclude(entry, entryRequire.resolve)

  for (const [name, override] of Object.entries(g)) {
    const mock = Function('...args', `return (${override})(...args)`) // eslint-disable-line
    mocks.global[name] = global[name] = await mock(global[name], { context: global[Symbol.for('kLazarettoContext')], include })
  }

  for (const [name, override] of Object.entries(b)) {
    const mock = Function('...args', `return (${override})(...args)`) // eslint-disable-line
    mocks.builtin[name] = await mock(require(name), { context: global[Symbol.for('kLazarettoContext')], include })
    require.cache[name] = {
      exports: mocks.builtin[name]
    }
  }

  for (const [name, override] of Object.entries(l)) {
    const mock = Function('...args', `return (${override})(...args)`) // eslint-disable-line
    try {
      entryRequire(name) // load the cache
      const mod = require.cache[entryRequire.resolve(name)]
      mocks.library[entryRequire.resolve(name)] = mod.exports = await mock(mod.exports, { context: global[Symbol.for('kLazarettoContext')], include })
    } catch (err) {
      if (err.code === 'ERR_REQUIRE_ESM') {
        const mod = await include(name)
        mocks.library[entryRequire.resolve(name)] = await mock(mod, { context: global[Symbol.for('kLazarettoContext')], include })
      } else {
        throw err
      }
    }
  }

  return (preload.result = { mocks, entry, builtins, libraries })
}
