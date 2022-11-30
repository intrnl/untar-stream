import { Untar } from '../src/index.js';
import { createIterableReader } from '@intrnl/iterable-reader';

/** @type {HTMLInputElement} */
let input = document.getElementById('input');
/** @type {HTMLUListElement} */
let list = document.getElementById('list');
/** @type {AbortController | null} */
let controller = null;

input.addEventListener('change', () => {
	let file = input.files[0];

	if (controller) {
		controller.abort();
	}

	controller = new AbortController();
	retrieveTarListing(file, controller.signal);
});

/**
 * @param {File} file
 * @param {AbortSignal} signal
 */
async function retrieveTarListing (file, signal) {
	let iterator = createStreamIterator(file.stream());
	let reader = createIterableReader(iterator);

	let untar = new Untar(reader);

	list.innerHTML = '';

	for await (let entry of untar) {
		if (signal.aborted) {
			break;
		}

		let li = document.createElement('li');
		li.textContent = `${entry.name} (${entry.size} b)`;

		list.appendChild(li);
	}

	reader.close();
}

// older browsers might not have async iterators on ReadableStream just yet.
function createStreamIterator (stream) {
	// return if browser already supports async iterator in stream
	if (stream[Symbol.asyncIterator]) {
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
