'use strict'
const { createRequire } = require('module')
const { isAbsolute } = require('path')
const sanity = require('./sanity')

const globals = new Set(Object.getOwnPropertyNames(global))
const possibleConflict = new Set(Object.getOwnPropertyNames(global).filter((s) => {
  return s.toLowerCase() === s
}))

const cjsScoped = ['__dirname', '__filename', 'exports', 'module', 'require']

function serializeFn (fn) {
  let str = fn.toString()
  try {
    sanity(str)
    return str
  } catch (err) {
    if (err instanceof SyntaxError) {
      if (/async/.test(str)) str = str.replace(/async/, 'async function ')
      else str = 'function ' + str

      try {
        sanity(str)
      } catch (err) {
        if (err instanceof SyntaxError && /Unexpected token '\['/.test(err.message)) {
          str = str.replace(/\[(.*?)(\()/s, 'anonymous $2')
          sanity(str)
        } else throw err
      }
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

  const isBuiltin = (name) => {
    if (isAbsolute(name)) return false
    const resolved = entryRequire.resolve(name)
    return resolved === name
  }

  for (const [name, override] of Object.entries(mock)) {
    const serializedFn = serializeFn(override)

    if (name === 'process' || name === 'console') {
      // process and console are a special case as they're both
      // a global, a builtin module and
      // lowercase which means npm i console or npm i process
      // could also override the builtin module
      if (override.dependency) {
        l[entryRequire.resolve(name)] = serializedFn
      }
      g[name] = serializedFn
      b[name] = serializedFn
      continue
    }

    if (scoped.has(name)) {
      s[name] = serializedFn
      continue
    }

    if (globals.has(name)) {
      if (possibleConflict.has(name)) {
        if (override.dependency) {
          l[entryRequire.resolve(name)] = serializedFn
          continue
        }
      }
      g[name] = serializedFn
      continue
    }

    try {
      if (isBuiltin(name)) b[name] = serializedFn
      else l[entryRequire.resolve(name)] = serializedFn
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
