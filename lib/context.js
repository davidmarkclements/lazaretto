'use strict'

const context = async () => {
  const { parentPort, workerData } = await import('worker_threads')
  const set = (o, p, v) => {
    o[p] = v
    parentPort.postMessage(['context', o])
    return true
  }

  return new Proxy(workerData ? workerData.context : {}, { set })
}

module.exports = context
