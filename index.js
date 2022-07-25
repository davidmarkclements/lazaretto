'use strict'
const { pathToFileURL } = require('url')
const { join } = require('path')
const { promisify } = require('util')
const { mkdtemp, writeFile, readFile, rm } = require('fs').promises
const { Worker } = require('worker_threads')
const mockery = require('./lib/mockery')
const cp = require('child_process')
const os = require('os')

async function lazaretto ({ esm = false, entry, scope = [], context = {}, mock, teardown, returnOnError = false, prefix = '' } = {}) {

  if (Array.isArray(scope) === false) scope = [scope]

  if (returnOnError === true) returnOnError = (err) => err

  const scoping = scope.reduce((scoping, ref) => {
    if (typeof ref === 'string') scoping += `${ref},`
    if (ref !== null && typeof ref === 'object') {
      scoping += `${ref[0]}:${ref[1]}`
    }
    return scoping
  }, '{') + '}'
  const entryUrl = pathToFileURL(entry).href
  const include = esm ? 'await import' : 'require'
  const mocking = mockery(mock, { esm, entry })
  const shims = esm
    ? `import.meta.url = '${entryUrl}';global[Symbol.for('kLazarettoImportMeta')] = import.meta;`
    : `module.id = '.'; module.parent = null; require.main = module;${mocking ? mocking.scopeMocks() : ''};`
  const overrides = `
    process.chdir = () => {
      process.stderr.write('Lazaretto: process.chdir is not supported\\n')
    }
    process.abort = () => {
      process.stderr.write('Lazeretto: Abort is not supported but will exit\\n' + Error().stack + '\\n')
      process.exit(1)
    }
  `
  const comms = `
    {
      const vm = ${include}('vm')
      const wt = ${include}('worker_threads')
      const { createInclude } = ${include}('${require.resolve('./lib/include')}')
      const include = createInclude('${entry}')
      async function cmds ([cmd, args] = []) {
        try {
          if (cmd === 'init') this.postMessage([cmd])
          if (cmd === 'sync') this.postMessage([cmd, wt.workerData.context, Array.from(global[Symbol.for('kLazarettoMocksLoaded')])])
          if (cmd === 'expr') {
            const expr = args.shift()
            const script = new vm.Script(expr, {filename: 'Lazaretto'})
            const thisContext = Object.getOwnPropertyNames(global).reduce((o, k) => { o[k] = global[k];return o}, {})
            let exports = null
            if (await global[Symbol.for('kLazarettoEntryModule')]) {
              const mod = await global[Symbol.for('kLazarettoEntryModule')]
              const target = typeof mod.default === 'function' ? mod.default : mod
              exports = new Proxy(target, { get (o, p) { 
                return 'p' in mod ? mod[p] : (mod.default ? mod.default[p] : undefined)
              }})
            } else { 
              try { exports = module.exports } catch { exports = {} }
            }
            let result = await script.runInNewContext({...thisContext,...(${scoping}), exports, $$$: { include, args, context: global[Symbol.for('kLazarettoContext')]}})
            if (result === exports) {
              try {
                result = global[Symbol.for('kLazarettoEntryModule')] || module.exports
              } catch {
                result = {}
              }
            }
            this.postMessage([cmd, result])
          }
        } catch (err) {
          if (err.name === 'DataCloneError') {
            const e = Error(err.message)
            e.name = 'DataCloneError'
            throw e
          }
          
          this.postMessage(['err', err, cmd, ...args])

        }
      }
      wt.parentPort.on('message', cmds)
    }
  `.split('\n').map((s) => s.trim() + ';').join('')
  const contents = await readFile(entry, 'utf8')

  const code = `${prefix}${overrides}${shims}${comms}${contents}`

  const inject = entry + '.lazaretto.' + Date.now() + (esm ? '.mjs' : '.cjs')
  await writeFile(inject, code)
  const exec = new URL(pathToFileURL(inject))

  if (esm) {
    process.env.LAZARETTO_LOADER_DATA_URL = exec.href
  }
  process.env.LAZARETTO_LOADER_ENTRY = entry

  if (mocking) process.env.LAZARETTO_OVERRIDES = JSON.stringify(mocking)
  const worker = new Worker(exec, {
    workerData: { context },
    execArgv: [
      ...process.execArgv,
      '--no-warnings',
      `--experimental-loader=${join(__dirname, 'lib', 'loader.mjs')}`
    ]
  })
  let online = false

  worker.on('message', ([cmd, o]) => {
    if (cmd !== 'context') return
    Object.assign(context, o)
  })

  worker.on('exit', () => {
    online = false
  })

  await hook('init')

  online = true

  const sandbox = async (code, ...args) => {
    if (returnOnError === false) {
      try {
        const [result] = await hook('expr', [code, ...args])
        return result
      } finally {
        await rm(inject)
      }
    }
    try {
      const [result] = await hook('expr', [code, ...args])
      return result
    } catch (err) {
      return returnOnError(err)
    } finally {
      await rm(inject)
    }
  }

  sandbox.context = context
  sandbox.mocksLoaded = null

  sandbox.fin = async () => {
    if (esm) {
      delete process.env.LAZARETTO_LOADER_DATA_URL
      delete process.env.LAZARETTO_LOADER_ENTRY
    }
    if (online === false) return
    const [ctx, mocksLoaded] = await hook('sync')
    Object.assign(context, ctx)
    sandbox.mocksLoaded = mocksLoaded
    await worker.terminate()
  }

  if (typeof teardown === 'function') teardown(sandbox.fin)

  return sandbox

  function hook (cmd, args = []) {
    return promisify((worker, cb) => {
      let done = false
      const msg = ([cmdIn, ...args]) => {
        if (cmdIn === 'err') {
          error(args[0])
          return
        }
        if (cmdIn !== cmd) return
        worker.removeListener('error', error)
        if (done === false) {
          cb(null, args)
        }
        done = true
      }
      const error = (err) => {
        worker.removeListener('message', msg)
        done = true

        const stack = err.stack.split('\n')
        let frame = esm
          ? stack.find((frame) => /data:text\/javascript;base64,/.test(frame))
          : stack[0]

        let restack = esm
          ? err.stack
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
          err = Object.create(err)
          err.stack = restack
          err.line = line
          err.esm = esm
          if (err.name === 'DataCloneError' && cmd === 'expr') {
            err.message = `Lazaretto Sandbox Error: \`${args[0].trim()}\` is not clonable: 
              ${err.message}
              See https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm
            `
          } else {
            const banner = stack.find((line) => msgRx.test(line))
            err.message = 'Lazaretto Sandbox Error: \n' + banner
            const diagnosis = contents.split('\n')
            diagnosis[line - 1] = `${diagnosis[line - 1]} <--- ### ${banner} ###`

            const nctx = 5
            const from = line - nctx < 0 ? 0 : line - nctx
            const to = line + nctx > diagnosis.length - 1 ? diagnosis.length - 1 : line + nctx
            err.diagnosis = diagnosis.slice(from, to).map((line, n) => `${n + from}: ${line}`).join('\n')
          }
        }
        cb(err)
      }

      worker.on('message', msg)
      worker.once('error', error)
      worker.postMessage([cmd, args])
    })(worker)
  }
}
module.exports = lazaretto
