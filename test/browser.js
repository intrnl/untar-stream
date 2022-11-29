import { Untar } from '../src/index.js';
import { createStreamIterator } from '@intrnl/chunked-uint8-iterator';

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
	let stream = createStreamIterator(file.stream());
	let untar = new Untar(stream);

	list.innerHTML = '';

	for await (let entry of untar) {
		if (signal.aborted) {
			break;
		}

		let li = document.createElement('li');
		li.textContent = `${entry.name} (${entry.size} b)`;

		list.appendChild(li);
	}
}
