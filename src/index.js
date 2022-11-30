/**
 * @typedef {object} ReadSeeker
 * @property {(p: Uint8Array) => Promise<number | null>} read
 * @property {(offset: number, whence: number) => Promise<number>} seek
 */

let RECORD_SIZE = 512;
let INITIAL_CHECKSUM = 8 * 32;

let USTAR_FIELDS = [
	{ label: 'name',        length: 100 },
	{ label: 'mode',        length: 8   },
	{ label: 'uid',         length: 8   },
	{ label: 'gid',         length: 8   },
	{ label: 'size',        length: 12  },
	{ label: 'mtime',       length: 12  },
	{ label: null,          length: 8   },
	{ label: 'type',        length: 1   },
	{ label: 'linkName',    length: 100 },
	{ label: null,          length: 8   },
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

let SEEK_MODE_CURRENT = 1;

export class Untar {
	/**
	 * @param {ReadSeeker} reader
	 */
	constructor (reader) {
		/** @type {TarEntry | null} */
		this.entry = null;

		this._reader = reader;
		this._chunk = new Uint8Array(512);
	}

	/**
	 * @returns {Promise<TarEntry | null>}
	 */
	async extract () {
		if (this.entry) {
			// discard the entry to read the next one
			await this.entry.discard();
		}

		let header = await this._getHeader();

		if (header === null) {
			return null;
		}

		let entry = new TarEntry(header, this._reader);

		this.entry = entry;
		return entry;
	}

	/**
	 * @returns {AsyncIterableIterator<TarEntry>}
	 */
	getIterator () {
		let _this = this;

		return {
			[Symbol.asyncIterator] () {
				return this;
			},

			async next () {
				let entry = await _this.extract();

				if (entry === null) {
					return { value: null, done: true };
				}

				return { value: entry, done: false };
			},
		};
	}

	[Symbol.asyncIterator] () {
		return this.getIterator();
	}

	/**
	 * Retrieve the 512-byte header block from reader
	 * @private
	 * @returns {Promise<null | Record<string, Uint8Array>>}
	 */
	async _getHeader () {
		let chunk = this._chunk;
		let read = await this._reader.read(chunk);

		if (read === null) {
			return null;
		}

		let blocksum = this._getChecksum(chunk);

		if (parseInt(decodeString(chunk.subarray(148, 156)), 8) !== blocksum) {
			// Reached end of file
			if (blocksum === INITIAL_CHECKSUM) {
				return null;
			}

			throw new Error(`Checksum error`);
		}

		if (decodeString(chunk.subarray(257, 263)).indexOf('ustar') !== 0) {
			throw new Error(`Unsupported archive format: ${magic}`)
		}

		return this._parseHeader(chunk);
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
			if (field.label !== null) {
				header[field.label] = block.subarray(offset, offset + field.length);
			}

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
	 * @param {ReadSeeker} reader
	 */
	constructor (header, reader) {
		this._parseMetadata(header);

		this._read = 0;
		this._reader = reader;
	}

	async discard () {
		let remaining = this.entrySize - this._read;

		if (remaining <= 0) {
			return;
		}

		await this._reader.seek(remaining, SEEK_MODE_CURRENT);
	}

	/**
	 * @param {Uint8Array} p
	 * @returns {Promise<number | null>}
	 */
	async read (p) {
		let remaining = this.size - this._read;

		if (remaining <= 0) {
			return null;
		}

		if (remaining >= p.byteLength) {
			this._read += p.byteLength;
			return this._reader.read(p);
		}

		// User exceeded the remaining size of this entry, we can't fulfill that
		// directly because it means reading partially into the next entry
		this._read += remaining;

		let block = new Uint8Array(remaining);
		let n = await this._reader.read(block);

		p.set(block, 0);
		return n;
	}

	/**
	 * Transform the header into proper file metadata
	 * @param {Record<string, Uint8Array>} header
	 */
	_parseMetadata (header) {
		let _prefix = decodeString(header.prefix);
		let _name = decodeString(header.name);

		this.name = _prefix.length > 0 ? _prefix + '/' + _name : _name;

		this.mode = decodeOctal(header.mode);
		this.uid = decodeOctal(header.uid);
		this.gid = decodeOctal(header.gid);

		this.size = decodeOctal(header.size);
		this.mtime = decodeOctal(header.mtime);

		this.type = FILE_TYPES[decodeOctal(header.type)];

		this.linkName = decodeString(header.linkName);

		this.owner = decodeString(header.owner);
		this.group = decodeString(header.group);

		this.majorNumber = decodeOctal(header.majorNumber);
		this.minorNumber = decodeOctal(header.minorNumber);

		this.entrySize = Math.ceil(this.size / RECORD_SIZE) * RECORD_SIZE;
	}
}

/**
 * Decode buffer into string
 * @param {Uint8Array} arr
 * @returns {string}
 */
 function decodeString (arr) {
	let res = '';

	for (let idx = 0, len = arr.length; idx < len; idx++) {
		let code = arr[idx];

		if (code === 0) {
			break;
		}

		res += String.fromCharCode(code);
	}

	return res;
}

function decodeOctal (arr) {
	let res = decodeString(arr);
	return res ? parseInt(res, 8) : 0;
}
