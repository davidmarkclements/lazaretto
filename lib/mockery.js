'use strict'
const { createRequire } = require('module')
const { isAbsolute } = require('path')
const sanity = require('./sanity')

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
          str = str.replace(/\[(.*)\]/s, 'anonymous')
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

    if (name === 'process') {
      // process is a special case as it's both
      // a global, a builtin module and it's
      // lowercase which means npm i process
      // could also override it
      g[name] = serializedFn
      if (isBuiltin(name)) b[name] = serializedFn
      else l[entryRequire.resolve(name)] = serializedFn
    }

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
          if (override.global !== false) conflictWarning(name)
          if (isBuiltin(name)) b[name] = serializeFn
          else l[entryRequire.resolve(name)] = serializedFn
          continue
        } catch (err) {
          g[name] = serializedFn
          continue
        }
      }
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
