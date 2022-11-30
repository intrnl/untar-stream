# untar-stream

Streamable implementation of untar

This library expects a ReadSeeker interface, you can convert async iterables by
using [`@intrnl/iterable-reader`][iterable-reader].

```js
import { createReadStream } from 'node:fs';
import { createIterableReader } from '@intrnl/iterable-reader';
import { Untar } from '@intrnl/untar-stream';

let stream = createReadStream('./archive.tar');

let reader = createIterableReader(stream);
let untar = new Untar(reader);

for await (let entry of untar) {
	console.log(entry.name);

	if (entry.name === 'actor.json') {
		let bytes = new Uint8Array(entry.size);
		await entry.read(bytes);

		let decoder = new TextDecoder();
		let text = decoder.decode(bytes);

		console.log(JSON.parse(text));
	}
}
```

[iterable-reader]: https://codeberg.org/intrnl/iterable-reader

## Working with Web Streams

Unfortunately browsers hasn't implemented using ReadableStream directly as an
async iterator, in the meantime, you could use this to convert them into one.

```js
function createStreamIterator (stream) {
	// return if browser already supports async iterator in stream
	if (Symbol.asyncIterator in stream) {
		return stream[Symbol.asyncIterator]();
	}

	let reader = stream.getReader();

	return {
		[Symbol.asyncIterator] () {
			return this;
		},
		next () {
			return reader.read();
		},
		return () {
			reader.releaseLock();
		},
		throw () {
			reader.releaseLock();
		},
	};
}
```
