'use strict'
const { createRequire } = require('module')
const include = (entry) => {
  const { resolve } = createRequire(entry)
  return async (ns) => {
    const mod = await import(resolve(ns))
    return new Proxy(mod, {
      get (o, p) {
        return o[p] || (o.default ? o.default[p] : undefined)
      }
    })
  }
}

module.exports = include
