'use strict'
const { createRequire } = require('module')
const { Script } = require('vm')

const globals = new Set(Object.getOwnPropertyNames(global))
const possibleConflict = new Set(Object.getOwnPropertyNames(global).filter((s) => {
  return s !== 'process' && s.toLowerCase() === s
}))

const conflictWarning = (name) => {
  process.emitWarning(`
    ${name} mock could refer to global or the installed ${name} package. 
    Set the mock['${name}'].global property to true or false to disambiguate.
  `)
}

const cjsScoped = ['__dirname', '__filename', 'exports', 'module', 'require']

function serializeFn (fn) {
  let str = fn.toString()
  try {
    new Script(str) // eslint-disable-line
    return str
  } catch (err) {
    if (err instanceof SyntaxError) {
      if (/async/.test(str)) str = str.replace(/async/, 'async function ')
      else str = 'function ' + str
      new Script(str) // eslint-disable-line
      return str
    }
  }
}

function mockery (mock, { esm, entry }) {
  if (!mock) return null
  const scoped = new Set(esm ? [] : cjsScoped)
  const entryRequire = createRequire(entry)
  const g = {} // global overrides
  const b = {} // builtin overrides
  const l = {} // lib overrides
  const s = {} // scope overrides

  for (const [name, override] of Object.entries(mock)) {
    const serializedFn = serializeFn(override)

    if (scoped.has(name)) {
      s[name] = serializedFn
      continue
    }

    if (globals.has(name)) {
      if (override.global === true) {
        g[name] = serializedFn
        continue
      }
      if (possibleConflict.has(name)) {
        try {
          const resolved = entryRequire.resolve(name)
          if (override.global !== false) conflictWarning(name)
          const builtin = resolved === name
          if (builtin) b[name] = serializeFn
          else l[name] = serializedFn
          continue
        } catch (err) {
          g[name] = serializedFn
          continue
        }
      }
    }

    try {
      const resolved = entryRequire.resolve(name)
      const builtin = resolved === name
      if (builtin) b[name] = serializedFn
      else l[name] = serializedFn
    } catch (err) {
      throw Error(`Lazaretto: mock['${name}'] is not resolvable from ${entry}`)
    }
  }

  function scopeMocks () {
    const lines = []
    for (const [name, override] of Object.entries(s)) {
      lines.push(`${name} = (${override})(${name}, {context: global[Symbol.for('kLazarettoContext')], require})`)
    }
    return lines.join(';')
  }
  return { entry, g, b, l, scopeMocks }
}

module.exports = mockery
