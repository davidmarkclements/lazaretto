'use strict'
const { createRequire } = require('module')
const { LAZARETTO_OVERRIDES } = process.env
const { entry = process.cwd(), g = {}, b = {}, l = {} } = LAZARETTO_OVERRIDES ? JSON.parse(LAZARETTO_OVERRIDES) : {}
const createInclude = require('./include')
const context = require('./context')

const builtins = new Set(Object.keys(b))
const libraries = new Set(Object.values(l).map(({ name }) => name))

const globalsFromBuiltinExports = {
  setTimeout: 'timers',
  clearTimeout: 'timers',
  setImmediate: 'timers',
  clearImmediate: 'timers',
  setInterval: 'timers',
  clearInterval: 'timers',
  Buffer: 'buffer',
  URL: 'url',
  TextEncoder: 'util',
  TextDecoder: 'util'
}

module.exports = preload

async function preload () {
  const mocks = {
    global: {},
    library: {},
    builtin: {}
  }

  global[Symbol.for('kLazarettoContext')] = await context()
  const mocksLoaded = global[Symbol.for('kLazarettoMocksLoaded')] = new Set()

  if (!LAZARETTO_OVERRIDES) return { mocks, entry, builtins, libraries }
  const entryRequire = createRequire(entry)
  const include = createInclude(entry)

  for (const [name, override] of Object.entries(g)) {
    const mock = Function('...args', `return (${override})(...args)`) // eslint-disable-line
    mocks.global[name] = global[name] = await mock(global[name], { context: global[Symbol.for('kLazarettoContext')], include })
  }

  for (const [name, override] of Object.entries(b)) {
    const mock = Function('...args', `return (${override})(...args)`) // eslint-disable-line
    mocks.builtin[name] = await mock(require(name), { context: global[Symbol.for('kLazarettoContext')], include })
    // special case API's with a <name>.promises export and a <name>/promises namespace
    if (name === 'fs') {
      if ('promises' in mocks.builtin[name]) {
        const slashPromises = `${name}/promises`
        builtins.add(slashPromises)
        mocks.builtin[slashPromises] = mocks.builtin[name].promises
      }
    }
  }
  const paraMocks = {}
  for (const name of Object.keys(g)) {
    const builtinWithMockedGlobal = globalsFromBuiltinExports[name]
    if (!builtinWithMockedGlobal) continue
    if (builtinWithMockedGlobal in mocks.builtin) continue
    paraMocks[builtinWithMockedGlobal] = paraMocks[builtinWithMockedGlobal] || require(builtinWithMockedGlobal)
    paraMocks[builtinWithMockedGlobal] = new Proxy(paraMocks[builtinWithMockedGlobal], {
      get (o, k) {
        if (k === name) return mocks.global[name]
        return o[k]
      }
    })
  }
  Object.assign(mocks.builtin, paraMocks)
  for (const name of Object.keys(mocks.builtin)) {
    builtins.add(name)
    require.cache[name] = {
      get exports () {
        mocksLoaded.add(name)
        return mocks.builtin[name]
      },
      set exports (v) { /* swallow future sets */ }
    }
  }

  for (const [resolvedPath, { name, override }] of Object.entries(l)) {
    const mock = Function('...args', `return (${override})(...args)`) // eslint-disable-line
    try {
      entryRequire(name) // load the cache
      const mod = require.cache[resolvedPath]
      mocks.library[name] = mod.exports = await mock(mod.exports, { context: global[Symbol.for('kLazarettoContext')], include })
      require.cache[resolvedPath] = {
        get exports () {
          mocksLoaded.add(name)
          return mocks.library[resolvedPath]
        },
        set exports (v) { /* swallow future sets */ }
      }
    } catch (err) {
      if (err.code === 'ERR_REQUIRE_ESM') {
        const mod = await include(name)
        mocks.library[name] = await mock(mod, { context: global[Symbol.for('kLazarettoContext')], include })
      } else {
        throw err
      }
    }
  }
  return { mocks, entry, builtins, libraries }
}
