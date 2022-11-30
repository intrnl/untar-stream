import { createReadStream } from 'node:fs';
import { createIterableReader } from '@intrnl/iterable-reader';
import { Untar } from '../src/index.js';

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
