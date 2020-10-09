# Lazaretto

> Run esm and/or cjs code in a separate V8 isolate with code-injection capabilities

## Status

Experimental

## Support

* Node 14+
* Might work on Node 12, but that is not supported nor tested

## About

Lazaretto is for circumstances where you want to execute` isolated code that is fully interopable with 
either of Node's module systems while also being able to dyanmically run expressions inside that code. 
This authors use-case is a sort of white-box testing (which is generally not recommended), but which is 
necessary for evaluating exam questions for the OpenJS Certifications. Lazaretto should not be relied on
for completely safe isolation, the file system and so forth can still be accessed so you still need 
containers/vms for safe isolation of user code.

## API

```js
const lazaretto = require('lazaretto')
```

```js
import lazaretto from 'lazaretto'
```

### `await lazaretto({ esm = false, entry, scope, mock, context, prefix }) => sandbox <(expression: String) => result)>`

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
except it smooths over the `default` ugliness.


##### `context` - Object, default: {}

Sets the initial context that is then passed to mock handler functions. See [`sandbox.context`](#sandbox.context-object)

##### `prefix` - String, default: ''

Inject code at the top of `entry` contents prior to execution.


#### `sandbox` <(expression: String) => result)>

Lazretto returns a promise that resolves to a sandbox function. Pass it an expression to evaluate. 

Imagine a file stored at `/path/to/file.mjs` which contains

```js
function fn () { return true }
```

The file can be evaluated with Lazaretto like so:

```js
import assert from 'assert'
import lazaretto from 'lazaretto'
const sandbox = await lazaretto({ esm: true, entry: '/path/to/file.mjs', scope: ['fn'] })
assert.strict.equal(sandbox(`fn()`), true)
```

Data return from evaluating an expression in the sandbox is cloned from the isolate thread according to the [HTML structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm) which means you can't return functions, and a Node `Buffer` will be cloned as a `Uint8Array` - see https://nodejs.org/api/worker_threads.html#worker_threads_considerations_when_transferring_typedarrays_and_buffers.

##### `sandbox.context` - Object

The `sandbox.context` object is synchronised with any changes made to the `api.context` object in any of the mocks.
Any state stored on context is passed between the main thread and the worker thread (and vice-versa), this means the
[HTML structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm) 
is used to synchronize the main and worker thread context objects. Therefore functions cannot be transferred and there
are caveats around how to handle buffers.


## Todo

* tests
* browser support?

## License

MIT

