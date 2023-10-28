import { register } from 'module'
import preload from './preload.js'

// got to preload here, but also need to comm mocks loaded between threads
global[Symbol.for('kLazarettoMocks')] = (await preload()).mocks

register('./loader.mjs', import.meta.url)
