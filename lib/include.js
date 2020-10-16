'use strict'
const { createRequire } = require('module')
const include = (entry) => {
  const { resolve } = createRequire(entry)
  return async (ns) => {
    const mod = await import(resolve(ns))
    const target = typeof mod.default === 'function' ? mod.default : mod
    return new Proxy(target, {
      get (o, p) {
        return mod[p] || (mod.default ? mod.default[p] : undefined)
      }
    })
  }
}

module.exports = include
module.exports.createInclude = include