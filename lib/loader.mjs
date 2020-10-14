import Module from 'module'
import path from 'path'
import { pathToFileURL } from 'url'
import preload from './preload.js'
import sanity from './sanity.js'

const {
  LAZARETTO_LOADER_RELATIVE_DIR,
  LAZARETTO_LOADER_DATA_URL
} = process.env

const { mocks, builtins, libraries } = await preload()

let esmEntry = null

global[Symbol.for('kLazarettoMocks')] = mocks

export function resolve (specifier, ctx, defaultResolve) {
  if (/data:cjs/.test(specifier)) {
    const [, contents] = specifier.split(';')
    const [file, encoded] = contents.split(',')
    const code = Buffer.from(encoded, 'base64').toString()
    const { _compile } = Module.prototype
    Module.prototype._compile = function (content, filename) {
      if (filename === file) content = code
      return _compile.call(this, content, filename)
    }
    return defaultResolve(file, ctx, defaultResolve)
  }
  if (/data:esm/.test(specifier)) {
    const [, contents] = specifier.split(';')
    const [, code] = contents.split(',')
    return {
      url: `esm:${code}`
    }
  }

  if (/data:lazaretto/.test(specifier)) {
    return defaultResolve(`data:text/javascript;base64,${esmEntry}`, ctx, defaultResolve)
  }
  if (/node:/.test(specifier)) specifier = specifier.split(':')[1]

  if (builtins.has(specifier)) {
    return {
      url: `mock-builtin:${specifier}`
    }
  }

  if (libraries.has(specifier)) {
    return {
      url: `mock-library:${specifier}`
    }
  }
  const { parentURL = null } = ctx
  if (specifier.startsWith('.') && parentURL && parentURL === LAZARETTO_LOADER_DATA_URL) {
    const absolute = path.resolve(LAZARETTO_LOADER_RELATIVE_DIR, specifier)
    if (libraries.has(absolute)) {
      return {
        url: `mock-library:${absolute}`
      }
    }
    return {
      url: pathToFileURL(absolute).href
    }
  }
  if (path.isAbsolute(specifier)) {
    return {
      url: pathToFileURL(specifier).href
    }
  }

  return defaultResolve(specifier, ctx, defaultResolve)
}

export async function getFormat (url, ctx, defaultGetFormat) {
  if (/mock-builtin:/.test(url) || /mock-library:/.test(url) || /esm:/.test(url)) {
    return { format: 'module' }
  }
  return defaultGetFormat(url, ctx, defaultGetFormat)
}

export async function getSource (url, ctx, defaultGetSource) {
  if (/esm:/.test(url)) {
    const [, code] = url.split(':')
    esmEntry = code
    const source = `
      export * from 'data:lazaretto;esm'
      const mod = await import('data:lazaretto;esm')
      global[Symbol.for('kLazarettoEntryModule')] = Object.assign({}, mod)
      export default mod.default
    `
    return { source }
  }

  if (/mock-builtin:/.test(url) || /mock-library:/.test(url)) {
    const [mockType, name] = url.split(':')
    const [, type] = mockType.split('-')
    const mod = mocks[type][name]
    const api = Object.getOwnPropertyNames(mod)
    const exports = api.map((k) => {
      try {
        // the following checks if the export value is legal
        sanity(`const ${k} = 1`)
        return `export const ${k} = mod['${k}']`
      } catch (err) {}
    }).filter(Boolean)
    if (api.includes('default') === false) exports.push('export default mod')

    const source = `
      const mod = global[Symbol.for('kLazarettoMocks')].${type}['${name}']
      ${exports.join('\n      ')}
    `
    return { source }
  }
  return defaultGetSource(url, ctx, defaultGetSource)
}
