# Lazaretto

> Run esm and/or cjs code in a separate V8 isolate with code-injection capabilities

## Status

Experimental

## Support

* Node 14+
* Might work on Node 12, but that is not supported nor tested

## About

Lazaretto is for circumstances where you want to execute isolated code that is fully interopable with 
either of Node's module systems while also being able to dynamically run expressions inside that code. 
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

### `await lazaretto({ esm = false, entry, scope }) => sandbox <(expression: String) => result)>`

#### Options

##### `esm` - Boolean, default: `false`. 

Set to `true` to load a native esm module (eg. `import`), `false` for a cjs module (eg `require`). See [is-file-esm](https://github.com/davidmarkclements/is-file-esm) for automatically determining whether a file is esm or not.

##### `entry` - String. Required. 

The entry-point file, must be an absolute path.


##### `scope` - Array, default: []. 

A list of references that we want to have in scope for running dynamic expressions. It can only access references in the outer module scope.
For instance, let's say we want to run code in a sandbox that has a function named `fn`, and then we want to call `fn` and get the result.
We would set the `scope` option to `['fn']`. 


#### `sandbox` <(expression: String) => result)>

Lazaretto returns a promise that resolves to a sandbox function. Pass it an expression to evaluate. 

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

## Todo

* tests
* browser support?

## License

MIT

