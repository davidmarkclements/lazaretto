# Lazaretto

> Run esm and/or cjs code in a separate V8 isolate with code-injection capabilities

## Support

* Node 14+

## About

Lazaretto is for circumstances where you want to execute isolated code that is fully interopable with 
either of Node's module systems while also being able to dynamically run expressions inside that code. 
This authors use-case is a sort of white-box testing (which is generally not recommended), but which is 
necessary for evaluating exam questions for the OpenJS Certifica tions. Lazaretto should not be relied on
for completely safe isolation, the file system and so forth can still be accessed so you still need 
containers/vms for safe isolation of user code.

## API

```js
const lazaretto = require('lazaretto')
```

```js
import lazaretto from 'lazaretto'
```

### `await lazaretto({ esm = false, entry, scope, mock, context, teardown, prefix }) => sandbox <(expression: String) => result)>`

#### Options

##### `esm` - Boolean, default: `false`. 

Set to `true` to load a native esm module (eg. `import`), `false` for a cjs module (eg `require`). See [is-file-esm](https://github.com/davidmarkclements/is-file-esm) for automatically determining whether a file is esm or not.

##### `entry` - String. Required. 

The entry-point file, must be an absolute path.


##### `scope` - Array, default: []. 

A list of references that we want to have in scope for running dynamic expressions. It can only access references in the outer module scope.
For instance, let's say we want to run code in a sandbox that has a function named `fn`, and then we want to call `fn` and get the result.
We would set the `scope` option to `['fn']`. 


##### `mock` - Object

The `mock` object can be used to override natives and libraries. The mocking of the following is supported

* builtin modules (`fs`, `path`, `child_process`...)
* globals (`process`, `Buffer`, `setTimeout`...)
* module-scoped variables (`__dirname`, `__filename`, `require`...) *CJS modules only*
* project-local libraries (`./path/to/file.js`, `/absolute/path/to/file.js`), resolution is relative to the `entry` path.
* project dependencies (as specified in `package.json`)

To mock supply the mocking target name as a key of the object and set it to a handler function: 

```js
  const mock = {
    async fs (fs, { context, include }) { return {mock: 'fs'} }
    ['./path/to/local-lib.js']: async (mod, { context, include }) => {
      return {another: 'mock'}
    },
    __dirname(__dirname, { context, require }) {
      return '/override/dirname'
    }
  }
  const sandbox = await lazaretto({ esm, entry, mock })
```

All handler functions except module-scoped variable handler functions **may** return a promise (e.g. be an `async function`). 

Module-scoped variable handler functions (e.g. `__dirname` etc.), **must** be synchronous functions. 

The handler function has the signature `(original, api) => {}` where `original` is the original value of the 
mock-target and `api` contains utilities for cross-module-system and cross-isolate interactions.

For all handler functions, `api.context` is an object which can be used to store state within the sandbox, 
this state will then be available in the main thread at [`sandbox.context`](#sandbox.context-object). 

For all handler function except module-scoped, there is an `api.include` function. This works in a similar
way to [Dynamic Import](https://wiki.developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/import#Dynamic_Imports), 
except it smooths over the `default` ugliness and it's relative to the `entry` file:

```js
  const mock = {
    async fs (fs, { include }) {
      const stream = await include('stream')
      return {
        __proto__: fs,
        createReadStream() { 
          return stream.Readable.from(['totally', 'mocked'])
        }
      }
    }
  }
  const sandbox = await lazaretto({ esm, entry, mock })
```

For module-scoped functions, there's `api.require` which is a `require` function that performs lookups
relative to the `entry` file:

```js
  const mock = {
    __filename (__filename, { require }) {
      const path = require('path')
      return path.join(path.dirname(__filename), 'override.js')
    }
  }
  const sandbox = await lazaretto({ esm, entry, mock })
```

**IMPORTANT, READ THIS**: the handler function are serialized and then executed inside the worker thread. This means
these functions will not be able to access any closure scope references since they are recompiled in a separate environment.

###### Implicit mocks

Some globals are also core modules, for instance, `process` and `console`. When these specified in the `mock` object both the global
and the module will be mocked. However, if a module named `process` or `console` is installed as a dependency, that will be mocked instead.

Some globals are present as methods in core modules. For instance the `Buffer` global is also exported from the `buffer` module,
and `setTimeout` is exported from `timers` etc. Globals that are parts of other modules will be mocked within those
modules when mocked, unless the module is *also* mocked in which case the export of the mocked module method will
be different from the mocked global.

For example, if `setTimeout` mock is created the `timers.setTimeout` export will also be mocked the same. However if both `timers` and `setTimeout` is mocked, the `setTimeout` export on `timers` will be prescribed by the `timers` mock.

Core modules can also have a `<name>/promises` path that exports promisified versions of the module's API which is also available on the as the `promises` property of that module. Currently only the `fs` module that does this. When a method on `fs.promises` is mocked, that method is also mocked on `fs/promises`. For instance given the following: 

```js
  const mock = {
    async fs (fs, { include }) {
      const { promisify } = await include('util')
      const readFile = (file, cb) => {
        process.nextTick(() => cb(null, Buffer.from('test')))
      }
      return {
        __proto__: fs,
        readFile,
        promises: {
          readFile: promisify(readFile)
        }
      }
    }
  }
  const sandbox = await lazaretto({ esm, entry, mock })
```

The `fs.promises.readFile` function has been mocked, so if `fs/promises` is required or imported it's `readFile` method
will be the same as `fs.promises.readFile`.

##### `context` - Object, default: {}

Sets the initial context that is then passed to mock handler functions. See [`sandbox.context`](#sandbox.context-object)

##### `prefix` - String, default: ''

Inject code at the top of `entry` contents prior to execution.

##### `returnOnError` - Function or Boolean, default: false

If `false` then the `sandbox` function will propagate the error. 
If `true` then the `sandbox` function will return a relevant error object if a particular expression causes a throw or rejection.
If a function then the `sandbox` function will return the result of passing the error to the `returnOnError` function.


##### `teardown` - Function, default: undefined

A function that takes a cleanup function (which may be an async function) that should be triggered outside of Lazaretto.

For instance: 

```js
import lazaretto from 'lazaretto'
let cleanup = () => {}
function teardown (fn) {
  cleanup = fn
}
try {
  const sandbox = await lazaretto({ esm: true, entry: '/path/to/file.mjs', teardown })
  sandbox('someFunctionThatMightError()')
  await sandbox.fin()
} catch (err) {
  await cleanup()
}
```

This is useful when using Lazaretto with a test framework, such as `tap`, for instance: 

```js
import tap from 'tap'
import lazaretto from 'lazaretto'

test('something', async ({ is, teardown }) => {
  const sandbox = await lazaretto({ esm: true, entry: '/path/to/file.mjs', teardown })
  is(sandbox('someFunctionThatMightError()'), true)
  await sandbox.fin()
})
```


#### `sandbox(expression, args) => Promise<result>`

Lazaretto returns a promise that resolves to a sandbox function. Pass it an expression to evaluate. 

Imagine a file stored at `/path/to/file.mjs` which contains

```js
function fn (inp) { return inp }
export const func = fn
```

The file can be evaluated with Lazaretto like so:

```js
import assert from 'assert'
import lazaretto from 'lazaretto'
const sandbox = await lazaretto({ esm: true, entry: '/path/to/file.mjs', scope: ['fn'] })
assert.strict.equal(await sandbox(`fn(true)`), true)
```

There are two implicit references available in sandbox expressions: `exports` and `$$args$$`

The `exports` reference holds the exports for `entry` file:

```js
import assert from 'assert'
import lazaretto from 'lazaretto'
const sandbox = await lazaretto({ esm: true, entry: '/path/to/file.mjs', scope: ['fn'] })
assert.strict.equal(await sandbox(`exports.func(42)`), 42)
assert.strict.equal(await sandbox(`exports.func === fn`), true)
```

The `$$args$$` reference holds a clone of the arguments passed to the sandbox after the expression: 

```js
import assert from 'assert'
import lazaretto from 'lazaretto'
const sandbox = await lazaretto({ esm: true, entry: '/path/to/file.mjs', scope: ['fn'] })
assert.strict.equal(await sandbox(`exports.func(...$$args$$)`, 'wow'), 'wow')
assert.strict.equal(await sandbox(`fn(...$$args$$)`, 'again'), 'again')
```

Data return from evaluating an expression in the sandbox is cloned from the isolate thread according to the [HTML structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm) which means you can't return functions, and a Node `Buffer` will be cloned as a `Uint8Array` - see https://nodejs.org/api/worker_threads.html#worker_threads_considerations_when_transferring_typedarrays_and_buffers.

##### `sandbox.context` - Object

The `sandbox.context` object is synchronised with any changes made to the `api.context` object in any of the mocks.
Any state stored on context is passed between the main thread and the worker thread (and vice-versa), this means the
[HTML structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm) 
is used to synchronize the main and worker thread context objects. Therefore functions cannot be transferred and there
are caveats around how to handle buffers.

##### `sandbox.mocksLoaded` - Array

The `sandbox.mocksLoaded` will be `null` until after `sandbox.fin()` is called. Afterwards it will be an array of
names (or paths in some cases) of mocks that were required or imported during execution.

## License

MIT

