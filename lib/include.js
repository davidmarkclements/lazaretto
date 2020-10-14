'use strict'
const { dirname } = require('path')
const isRelative = (path) => path[0] === '.'
const include = (entry, resolve) => async (ns) => {
  const mod = isRelative(ns) ? await import(resolve(dirname(entry), ns)) : await import(resolve(ns))
  return new Proxy(mod, {
    get (o, p) {
      return o[p] || (o.default ? o.default[p] : undefined)
    }
  })
}

module.exports = include
