import {
  sha256, toHexString, parseBridgeInfo, buildOtaBegin, buildOtaData, parseOtaEvent, parseSums, parseImageInfo, sameCommit,
  otaPayloadSize, releaseAssetNames, releaseTag, releaseDownloadUrl, otaErrorText, boardByte,
} from '../src/ble/bridgeFirmware';

const ascii = (s: string) => Uint8Array.from(Array.from(s).map((c) => c.charCodeAt(0)));

describe('sha256', () => {
  it('matches the standard test vectors', () => {
    expect(toHexString(sha256(new Uint8Array(0)))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(toHexString(sha256(ascii('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(toHexString(sha256(ascii('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });
  it('agrees with an independent SHA-256 on lengths around the 64-byte block edges and on a firmware-sized buffer', () => {
    const expected: Record<number, string> = {
      55: '81afe5b788dc2ce138ff83d9b20164db75a94d75d2b2432eea4a0ef605088c72',
      56: '2aba54f0ac632420a2b502431408866e40e1d5e430df4cd822642c78ab2eb9c1',
      63: '733d3d4ee79ee67145bf73da13588f6f235d37414fc64b14a2f00f1762792f5e',
      64: '79322907b3e9d013d7dc2c2f256674dbf733045cde01df3539271c6f5605feb8',
      65: 'd85c007c6eb440f085afa2b84f6f2bce4658b240e9f62cb1364bf0485a57e720',
      1000: '6b0df76627243d095b0c4400cb658b7e804dd03461cc03aee8fc8fe0bcada168',
    };
    for (const n of Object.keys(expected).map(Number)) {
      const d = new Uint8Array(n).map((_, i) => (i * 7 + n) & 255);
      expect(toHexString(sha256(d))).toBe(expected[n]);
    }
    const big = new Uint8Array(702384).map((_, i) => (i * 31 + (i >> 8)) & 255);
    expect(toHexString(sha256(big))).toBe('c5697355a4f6c3be464faf8a29b3a17e9eca006df91dbd3c738178891a52f5d3');
  });
});

describe('bridge info', () => {
  it('reads the flags, board, slot and commit', () => {
    const b = Uint8Array.from([1, 1, 1, 1, 0, ...ascii('bc3dfbd')]);
    expect(parseBridgeInfo(b)).toEqual({ protocol: 1, canUpdate: true, board: 'pro', slot: 1, commit: 'bc3dfbd' });
    expect(parseBridgeInfo(Uint8Array.from([1, 0, 0, 0, 0]))!.canUpdate).toBe(false);
    expect(parseBridgeInfo(Uint8Array.from([1, 1]))).toBeNull();
  });
});

describe('packets', () => {
  it('builds begin and data packets', () => {
    const sha = new Uint8Array(32).map((_, i) => i);
    const b = buildOtaBegin(702384, sha, 'pro');
    expect(b.length).toBe(38);
    expect(Array.from(b.subarray(0, 5))).toEqual([1, 0xb0, 0xb7, 0x0a, 0]);
    expect(b[5]).toBe(0);
    expect(b[36]).toBe(31);
    expect(b[37]).toBe(1);
    expect(boardByte('s3')).toBe(0);
    const d = buildOtaData(0x01020304, Uint8Array.from([9, 8, 7]));
    expect(Array.from(d)).toEqual([2, 4, 3, 2, 1, 9, 8, 7]);
  });
  it('reads the board notifications', () => {
    expect(parseOtaEvent(Uint8Array.from([0x81, 1]))).toEqual({ type: 'begin', slot: 1 });
    expect(parseOtaEvent(Uint8Array.from([0x82, 0, 0x10, 0, 0]))).toEqual({ type: 'progress', received: 4096 });
    expect(parseOtaEvent(Uint8Array.from([0x83]))).toEqual({ type: 'done' });
    expect(parseOtaEvent(Uint8Array.from([0xe1, 0x34, 0x12, 0, 0]))).toEqual({ type: 'resend', expected: 0x1234 });
    expect(parseOtaEvent(Uint8Array.from([0xe0, 5]))).toEqual({ type: 'error', code: 5 });
    expect(parseOtaEvent(Uint8Array.from([0x82, 1]))).toBeNull();
    expect(parseOtaEvent(Uint8Array.from([0x55]))).toBeNull();
    expect(otaErrorText(5)).toMatch(/checksum/);
  });
  it('sizes the chunks from the MTU', () => {
    expect(otaPayloadSize(247)).toBe(239);
    expect(otaPayloadSize(517)).toBe(240);
    expect(otaPayloadSize(23)).toBe(16);
    expect(otaPayloadSize(undefined)).toBe(16);
  });
});

describe('release files', () => {
  it('picks the file and tag for the board and build', () => {
    expect(releaseAssetNames('s3')).toEqual({ bin: 'firmware.bin', sums: 'SHA256SUMS.txt' });
    expect(releaseAssetNames('pro')).toEqual({ bin: 'firmware-pro.bin', sums: 'SHA256SUMS-pro.txt' });
    expect(releaseTag(true)).toBe('dev-latest');
    expect(releaseTag(false)).toBe('prod-latest');
    expect(releaseDownloadUrl('prod-latest', 'firmware.bin')).toBe('https://github.com/fizzgig17/hcri-esp32-bridge/releases/download/prod-latest/firmware.bin');
  });
  it('finds a hash in a sha256sum listing', () => {
    const h1 = 'a'.repeat(64), h2 = 'B'.repeat(64);
    const text = `${h1}  hcri-esp32-bridge-pro-factory.bin\n${h2}  firmware-pro.bin\n`;
    expect(parseSums(text, 'firmware-pro.bin')).toBe('b'.repeat(64));
    expect(parseSums(text, 'firmware.bin')).toBeNull();
    expect(parseSums(`${h1} *./firmware.bin\r\n`, 'firmware.bin')).toBe(h1);
  });
  it('reads the commit out of an app image', () => {
    const img = new Uint8Array(0x200);
    img[0] = 0xe9;
    new DataView(img.buffer).setUint32(0x20, 0xabcd5432, true);
    img.set(ascii('bc3dfbd'), 0x20 + 16);
    img.set(ascii('12:00:00'), 0x20 + 80);
    img.set(ascii('Oct 29 2026'), 0x20 + 96);
    expect(parseImageInfo(img)).toEqual({ commit: 'bc3dfbd', date: 'Oct 29 2026', time: '12:00:00' });
    img[0] = 0;
    expect(parseImageInfo(img)).toBeNull();
    expect(parseImageInfo(new Uint8Array(10))).toBeNull();
  });
  it('compares commits by their first seven characters, never "dev"', () => {
    expect(sameCommit('bc3dfbd', 'BC3DFBD1234')).toBe(true);
    expect(sameCommit('bc3dfbd', 'a59f61f')).toBe(false);
    expect(sameCommit('dev', 'dev')).toBe(false);
  });
});
