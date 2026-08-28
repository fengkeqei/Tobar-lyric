// Kugou KRC files are XOR-encrypted with a fixed key after the 4-byte
// "krc1" header. The canonical key is a 22-character string; only its
// low byte per character is effective.
const KRC_KEY = '@Gaw^2tGQ61-îŒαω/l}čΦ';
const KEY_BYTES = [...KRC_KEY].map(ch => ch.charCodeAt(0) & 0xFF);

export function decryptKrc(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length <= 4)
        return '';

    const header = 'krc1';
    for (let i = 0; i < 4; i++) {
        if (bytes[i] !== header.charCodeAt(i))
            return '';
    }

    const out = new Uint8Array(bytes.length - 4);
    for (let i = 4; i < bytes.length; i++)
        out[i - 4] = bytes[i] ^ KEY_BYTES[(i - 4) % KEY_BYTES.length];

    try {
        return new TextDecoder('utf-8').decode(out);
    } catch (_error) {
        return '';
    }
}
