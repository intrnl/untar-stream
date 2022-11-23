import { createReadStream } from 'node:fs';
import { Untar } from '../src/index.js';

let stream = createReadStream('./archive.tar');

let untar = new Untar(stream);

for await (let entry of untar) {
	console.log(entry.name);

	if (entry.name === 'actor.json') {
		let buf = new Uint8Array(entry.size);
		let offset = 0;

		for await (let values of entry) {
			buf.set(values, offset);
			offset += values.byteLength;
		}

		let decoder = new TextDecoder();
		console.log(decoder.decode(buf));
	}
}
