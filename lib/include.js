'use strict'
const { resolve, dirname } = require('path')
const isRelative = (path) => path[0] === '.'
const include = (entry) => async (ns) => {
  const mod = isRelative(ns) ? await import(resolve(dirname(entry), ns)) : await import(ns)
  return new Proxy(mod, {
    get (o, p) {
      return o[p] || (o.default ? o.default[p] : undefined)
    }
  })
}

module.exports = include
