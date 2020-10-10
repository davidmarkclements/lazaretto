'use strict'
const { Script } = require('vm')

function sanity (str) {
  new Script(str) // eslint-disable-line
}

module.exports = sanity
