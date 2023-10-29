import Module from 'module'
import path from 'path'
import { readFile } from 'fs/promises'
import { pathToFileURL, fileURLToPath } from 'url'
import preload from './preload.js'
import sanity from './sanity.js'

const {
  LAZARETTO_LOADER_ENTRY,
  LAZARETTO_LOADER_DATA_URL
} = process.env

const { mocks, builtins, libraries } = await preload()

const relativeDir = path.dirname(LAZARETTO_LOADER_ENTRY)
const entryUrl = pathToFileURL(LAZARETTO_LOADER_ENTRY).href
const mocksLoaded = global[Symbol.for('kLazarettoMocksLoaded')]
let esmEntry = null

global[Symbol.for('kLazarettoMocks')] = mocks

export function resolve (specifier, ctx, nextResolve) {

  if (/data:cjs/.test(specifier)) {
    const [, contents] = specifier.split(';')
    const [file, encoded] = contents.split(',')
    const code = Buffer.from(encoded, 'base64').toString()
    const { _compile } = Module.prototype
    Module.prototype._compile = function (content, filename) {
      if (filename === file) content = code
      return _compile.call(this, content, filename)
    }
    return {
      format: 'commonjs',
      url: 'file://' + file + '#cjs-' + encoded,
      shortCircuit: true
    }
  }
  if (/data:esm/.test(specifier)) {
    const [, contents] = specifier.split(';')
    const [, code] = contents.split(',')
    return {
      format: 'module',
      url: `esm:${code}`,
      shortCircuit: true
    }
  }

  if (/data:lazaretto/.test(specifier)) {
    return nextResolve(`data:text/javascript;base64,${esmEntry}`, ctx, nextResolve)
  }
  if (/node:/.test(specifier)) specifier = specifier.split(':')[1]

  if (builtins.has(specifier)) {
    return {
      url: `node:${specifier}#mock-builtin`,
      format: 'commonjs',
      shortCircuit: true
    }
  }

  if (libraries.has(specifier)) {
    return {
      url: `${specifier}#mock-library`,
      shortCircuit: true
    }
  }
  const { parentURL = '' } = ctx
  if (specifier.startsWith('.') && parentURL && parentURL === LAZARETTO_LOADER_DATA_URL) {
    const absolute = path.resolve(relativeDir, specifier)
    if (libraries.has(absolute)) {
      return {
        url: `${absolute}#mock-library`,
        shortCircuit: true
      }
    }
    return {
      url: pathToFileURL(absolute).href,
      shortCircuit: true
    }
  }
  if (path.isAbsolute(specifier)) {
    return {
      url: pathToFileURL(specifier).href,
      shortCircuit: true
    }
  }
  if (parentURL.slice(28) === esmEntry) {
    ctx.parentURL = entryUrl
  }
  return nextResolve(specifier, ctx, nextResolve)
}

export async function load (url, ctx, nextLoad) {
  if (/esm:/.test(url)) {
    const [, code] = url.split(':')
    esmEntry = code
    global[Symbol.for('kLazarettoEntryModule')] = (async () => Object.assign({}, await import('data:lazaretto;esm')))()
    const source = `
      export * from 'data:lazaretto;esm'
      const mod = await import('data:lazaretto;esm')
      global[Symbol.for('kLazarettoEntryModule')] = Object.assign({}, mod)
      export default mod.default
    `
    return { format: 'module', source, shortCircuit: true }
  }

  if (/#cjs-/.test(url)) {
    const [, encoded] = url.split('#cjs-')
    const code = Buffer.from(encoded, 'base64')
    return { format: 'commonjs', source: code, shortCircuit: true }
  }

  if (url.endsWith('#mock-builtin')) {
    const [name] = url.split(':').pop().split('#')
    const source = `module.exports = global[Symbol.for('kLazarettoMocks')].builtin['${name}']`
    mocksLoaded.add(name)
    return { format: 'commonjs', source, shortCircuit: true }
  }

  if (url.endsWith('#mock-library')) {
    const [name, mock] = url.split(':').pop().split('#')
    const type = mock.split('-').pop()
    const mod = mocks[type][name]
    const api = Object.getOwnPropertyNames(mod)
    const exports = api.map((k) => {
      try {
        // the following checks if the export value is legal
        sanity(`const ${k} = 1`)
        return `export const ${k} = mod['${k}']`
      } catch {
        return ''
      }
    }).filter(Boolean)
    if (api.includes('default') === false) exports.push('export default mod')

    const source = `
      const mod = global[Symbol.for('kLazarettoMocks')].${type}['${name}']
      ${exports.join('\n      ')}
    `
    mocksLoaded.add(name)
    return { format: 'module', source, shortCircuit: true }
  }

  const describe = await nextLoad(url, ctx, nextLoad)

  if (describe.format !== 'builtin' && describe.source === null && url.startsWith('file://')) {
    describe.source = await readFile(fileURLToPath(url))
  }

  return describe
}
