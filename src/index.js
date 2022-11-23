import chunked from '@intrnl/chunked-uint8-iterator';

let RECORD_SIZE = 512;
let INITIAL_CHECKSUM = 8 * 32;

let USTAR_FIELDS = [
  { label: 'name',        length: 100 },
  { label: 'mode',        length: 8   },
  { label: 'uid',         length: 8   },
  { label: 'gid',         length: 8   },
  { label: 'size',        length: 12  },
  { label: 'mtime',       length: 12  },
	{ label: 'checksum',    length: 8   },
  { label: 'type',        length: 1   },
	{ label: 'linkName',    length: 100 },
	{ label: 'ustar',       length: 8   },
	{ label: 'owner',       length: 32  },
  { label: 'group',       length: 32  },
  { label: 'majorNumber', length: 8   },
  { label: 'minorNumber', length: 8   },
  { label: 'prefix',      length: 155 },
  { label: null,          length: 12  },
];

let FILE_TYPES = {
  0: 'file',
  1: 'link',
  2: 'symlink',
  3: 'character-device',
  4: 'block-device',
  5: 'directory',
  6: 'fifo',
  7: 'contiguous-file',
};

let decoder = new TextDecoder();

export class Untar {
	/**
	 * @param {ReadableStream<Uint8Array>} stream
	 */
	constructor (stream) {
		/** @type {ReadableStream} */
		this.stream = stream;
		/** @type {TarEntry | null} */
		this.entry = null;

		this.reader = chunked(stream);
	}

	async extract () {
		if (this.entry && !this.entry._consumed) {
			// discard the body so we can read the next entry
			await this.entry.discard();
		}

		let header = await this._getHeader();

		if (header === null) {
			return null;
		}

		let entry = new TarEntry(header, this.reader);

		this.entry = entry;
		return entry;
	}

	async * [Symbol.asyncIterator] () {
		while (true) {
			let entry = await this.extract();

			if (entry === null) {
				return;
			}

			yield entry;
		}
	}

	/**
	 * Retrieve the 512-byte header block from reader
	 * @private
	 * @returns {Promise<null | Record<string, Uint8Array>>}
	 */
	async _getHeader () {
		let result = await this.reader.next();
		let block = result.value;

		if (block === null) {
			return null;
		}

		let header = this._parseHeader(block);
		let blocksum = this._getChecksum(block);

		let magic = decoder.decode(header.ustar);
		let checksum = decoder.decode(header.checksum);

		if (parseInt(checksum, 8) !== blocksum) {
			// Reached end of file
			if (blocksum === INITIAL_CHECKSUM) {
				return null;
			}

			throw new Error(`Checksum error`);
		}

		if (magic.indexOf('ustar') !== 0) {
			throw new Error(`Unsupported archive format: ${magic}`)
		}

		return header;
	}

	/**
	 * Parse the 512-byte header block containing file metadata
	 * @private
	 * @param {Uint8Array} block Block of Uint8Array(512)
	 * @returns {Record<string, Uint8Array>}
	 */
	_parseHeader (block) {
		let offset = 0;
		let header = {};

		for (let field of USTAR_FIELDS) {
			header[field.label] = block.subarray(offset, offset + field.length);
			offset += field.length;
		}

		return header;
	}

	/**
	 * Retrieve checksum of the header block
	 * @private
	 * @param {Uint8Array} block Block of Uint8Array(512)
	 * @returns {number}
	 */
	_getChecksum (block) {
		let sum = INITIAL_CHECKSUM;

		for (let i = 0; i < 512; i++) {
			// Ignore the checksum header
			if (i >= 148 && i < 156) {
				continue;
			}

			sum += block[i];
		}

		return sum;
	}
}


class TarEntry {
	/**
	 * @private
	 * @param {Uint8Array} header
	 * @param {ReturnType<typeof chunked>} reader
	 */
	constructor (header, reader) {
		this._parseMetadata(header);

		this.entrySize = Math.ceil(this.size / RECORD_SIZE) * RECORD_SIZE;

		this._consumed = false;

		this._read = 0;
		this._reader = reader;
	}

	async discard () {
		let iterator = this.getIterator();

		while (!this._consumed) {
			await iterator.next();
		}
	}

	/**
	 * @returns {AsyncIterableIterator<Uint8Array>}
	 */
	getIterator () {
		let entry = this;

		return {
			[Symbol.asyncIterator] () {
				return this;
			},

			async next () {
				let entryBytesLeft = entry.entrySize - entry._read;
				let bytesLeft = entry.size - entry._read;

				if (entryBytesLeft <= 0) {
					entry._consumed = true;
					return { done: true, value: null };
				}

				let result = await entry._reader.next();
				let values = result.value;
				let length = values.byteLength;

				if (values === null) {
					entry._consumed = true;
				}

				if (values === null || bytesLeft <= 0) {
					return { done: true, value: null };
				}

				entry._read += length;

				let buf = bytesLeft < length ? values.subarray(0, bytesLeft) : values;
				return { done: false, value: buf };
			},
		};
	}

	[Symbol.asyncIterator] () {
		return this.getIterator();
	}

	/**
	 * Transform the header into proper file metadata
	 * @param {Record<string, Uint8Array>} header
	 */
	_parseMetadata (header) {
		let _prefix = trim(header.prefix);

		let _owner = trim(header.owner);
		let _group = trim(header.group);

		let _name = decoder.decode(trim(header.name));

		this.name = _prefix.byteLength > 0
			? decoder.decode(_prefix) + '/' + _name
			: _name

		this.mode = parseInt(decoder.decode(header.mode), 8);
		this.uid = parseInt(decoder.decode(header.uid), 8);
		this.gid = parseInt(decoder.decode(header.gid), 8);

		this.size = parseInt(decoder.decode(header.size), 8);
		this.mtime = parseInt(decoder.decode(header.mtime), 8);

		this.type = FILE_TYPES[parseInt(decoder.decode(header.type), 8)];

		this.linkName = decoder.decode(trim(header.linkName));

		this.owner = _owner.byteLength > 0 ? decoder.decode(_owner) : null;
		this.group = _group.byteLength > 0 ? decoder.decode(_group) : null;

		this.majorNumber = parseInt(decoder.decode(header.majorNumber), 8);
		this.minorNumber = parseInt(decoder.decode(header.minorNumber), 8);
	}
}

/**
 * Remove trailing null codes from array
 * @param {Uint8Array} arr
 * @returns {Uint8Array}
 */
function trim (arr) {
	for (let idx = 0, len = arr.length; idx < len; idx++) {
		if (arr[idx] === 0) {
			return arr.subarray(0, idx);
		}
	}

	return arr;
}
