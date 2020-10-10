'use strict'
const { pathToFileURL } = require('url')
const { dirname, join } = require('path')
const { promisify } = require('util')
const { readFile } = require('fs').promises
const { Worker } = require('worker_threads')
const mockery = require('./lib/mockery')
const cp = require('child_process')
const timeout = promisify(setTimeout)

async function lazaretto ({ esm = false, entry, scope = [], context = {}, mock, prefix = '' } = {}) {
  if (Array.isArray(scope) === false) scope = [scope]
  const scopeParams = scope.length ? scope.map((ref) => {
    if (typeof ref === 'string') return `'${ref}'`
    if (ref !== null && typeof ref === 'object') {
      ref = Object.entries(ref).pop()
      return ref && `'${ref[0]}'`
    }
  }).filter(Boolean) + ',' : ''
  const scopeArgs = scope.map((ref) => {
    if (ref !== null && typeof ref === 'object') {
      ref = Object.entries(ref).pop()
      ref = ref && ref[1]
      if (ref === 'import.meta') return 'global[Symbol.for(\'kLazarettoImportMeta\')]'
      return ref
    }
    return ref
  }).filter(Boolean)

  const relativeDir = dirname(entry)
  const entryUrl = pathToFileURL(entry).href
  const include = esm ? 'await import' : 'require'
  const mocking = mockery(mock, { esm, entry })
  const shims = (esm ? `
    import.meta.url = '${entryUrl}';
    global[Symbol.for('kLazarettoImportMeta')] = import.meta
  ` : `
    module.path = __dirname = '${relativeDir}'
    module.id = module.filename = __filename = '${entry}'
    require = require('module').createRequire(__filename)
    require.main = module
    module.require = require
    module.paths = require.resolve.paths(__filename)
    ${mocking ? mocking.scopeMocks() : ''}
  `).split('\n').map((s) => s.trim() + ';').join('')
  const comms = `
    ${shims}
    {
      const { parentPort } = ${include}('worker_threads')
      parentPort.on${esm ? '' : 'ce'}('message', ([cmd, args]) => {
        if (cmd === 'init') {
          ${esm ? '' : 'global[Symbol.for(\'kLazarettoInit\')]()'}
          parentPort.postMessage(['init'])
        }
        ${esm ? `if (cmd === 'expr') {
          const expr = args.shift()
          const fn = new Function(${scopeParams}'return ' + expr)
          parentPort.postMessage([cmd, fn(${scopeArgs})])
        }` : ''}
      })
    }
  `.split('\n').map((s) => s.trim() + ';').join('')
  const contents = await readFile(entry, 'utf8')
  const wrapped = esm ? contents : `global[Symbol.for('kLazarettoInit')] = () => {
    {
      const { parentPort } = require('worker_threads')
      parentPort.on('message', ([cmd, args]) => {
        if (cmd === 'expr') {
          const expr = args.shift()
          const fn = new Function(${scopeParams}'return ' + expr)
          parentPort.postMessage([cmd, fn(${scopeArgs})])
        }
      })
    }`.split('\n').map((s) => s.trim() + ';').join('') + contents + '\n}'
  const code = `${prefix}${comms}${wrapped}`
  const exec = esm
    ? new URL(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
    : new URL(`data:cjs;${entry},${Buffer.from(code).toString('base64')}`)

  if (esm) {
    process.env.LAZARETTO_LOADER_DATA_URL = exec.href
    process.env.LAZARETTO_LOADER_RELATIVE_DIR = relativeDir
  }

  if (mocking) process.env.LAZARETTO_OVERRIDES = JSON.stringify(mocking)

  const worker = new Worker(exec, {
    workerData: { context },
    execArgv: [...process.execArgv, '--no-warnings', `--experimental-loader=${join(__dirname, 'lib', 'loader.mjs')}`]
  })

  worker.on('message', ([cmd, o]) => {
    if (cmd !== 'context') return
    Object.assign(context, o)
  })

  await hook('init')

  const sandbox = async (code, ...args) => {
    const [result] = await hook('expr', [code, ...args])
    return result
  }

  sandbox.context = context

  sandbox.fin = async () => {
    if (esm) {
      delete process.env.LAZARETTO_LOADER_DATA_URL
      delete process.env.LAZARETTO_LOADER_RELATIVE_DIR
    }
    return worker.terminate()
  }

  return sandbox

  function hook (cmd, args = []) {
    return promisify((worker, cb) => {
      let done = false
      const msg = ([cmdIn, ...args]) => {
        if (cmdIn !== cmd) return
        if (done === false) {
          cb(null, args)
          return
        }
        worker.removeListener('error', error)
        done = true
      }
      const error = (err) => {
        if (done === false) {
          const stack = err.stack.split('\n')
          let frame = esm
            ? stack.find((frame) => /data:text\/javascript;base64,/.test(frame))
            : stack[0]

          let restack = esm
            ? err.stack.replace(RegExp(exec.toString().replace(/([+|/])/g, '\\$1'), 'gm'), entry)
            : err.stack.replace(/\[worker eval\]:/gm, entry + ':')

          if (esm && !frame && err instanceof SyntaxError) {
            const { status, stderr } = cp.spawnSync(process.execPath, ['-c', entry], { encoding: 'utf8' })
            if (status) {
              frame = ':' + stderr.split('\n')[0]
              restack = `${stack[0]}\n    at ${entry}:${frame.split(':')[2]}`
            }
          }

          if (frame) {
            const line = esm ? +frame.split(':')[2] : +frame.split(':')[1]
            const escrx = require('escape-string-regexp') // lazy require
            const msgRx = RegExp(escrx(err.message))
            const banner = stack.find((line) => msgRx.test(line))
            err = Object.create(err)

            err.stack = restack
            err.line = line
            const diagnosis = contents.split('\n')
            diagnosis[line - 1] = `${diagnosis[line - 1]} <--- ### ${banner} ###`
            err.message = 'sandbox error: \n' + banner
            const nctx = 5
            const from = line - nctx < 0 ? 0 : line - nctx
            const to = line + nctx > diagnosis.length - 1 ? diagnosis.length - 1 : line + nctx
            err.diagnosis = diagnosis.slice(from, to).map((line, n) => `${n + from}: ${line}`).join('\n')
            err.esm = esm
          }

          cb(err)
          return
        }
        done = true
        worker.removeListener('message', msg)
      }

      worker.on('message', msg)
      worker.once('error', error)
      worker.postMessage([cmd, args])
    })(worker)
  }
}
module.exports = lazaretto
