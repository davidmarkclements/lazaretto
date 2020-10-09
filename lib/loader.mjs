import path from 'path'
import { pathToFileURL } from 'url'
const { LAZARETTO_LOADER_RELATIVE_DIR, LAZARETTO_LOADER_DATA_URL } = process.env

export function resolve (specifier, context, defaultResolve) {
  const { parentURL = null } = context
  if (specifier.startsWith('.') && parentURL && parentURL === LAZARETTO_LOADER_DATA_URL) {
    return {
      url: pathToFileURL(path.resolve(LAZARETTO_LOADER_RELATIVE_DIR, specifier)).href
    }
  }
  return defaultResolve(specifier, context, defaultResolve)
}
