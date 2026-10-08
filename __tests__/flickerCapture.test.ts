import { captureFlickerOnce } from '../src/ble/liveSessions';
import { buildShareCsv, buildCsv } from '../src/hcri/buildCsv';

// A fake meter connection that answers the flicker commands like the real meter does.
function fakeConn(opts: { silentWave?: boolean } = {}) {
  const listeners: ((m: { subCommand: number; body: Uint8Array }) => void)[] = [];
  const sent: string[] = [];
  const f32 = (v: number) => Array.from(new Uint8Array(new Float32Array([v]).buffer));
  const reply = (sub: number, body: number[]) => setTimeout(() => listeners.slice().forEach((l) => l({ subCommand: sub, body: Uint8Array.from(body) })), 1);
  const conn: any = {
    resetReassemblyState: () => {},
    msSinceLastNotify: () => '0.0s',
    onMessage: (l: any) => {
      listeners.push(l);
      return () => listeners.splice(listeners.indexOf(l), 1);
    },
    sendCommand: async (cmd: number[]) => {
      sent.push(cmd.map((b) => b.toString(16).padStart(2, '0')).join(' '));
      const sub = cmd[1];
      if (sub === 0x3d) reply(0x3d, [0x8c, 0x3d, 0x07]);
      else if (sub === 0x36) reply(0x36, [0x8c, 0x36, 0x01]);
      else if (sub === 0x3b) reply(0x3b, [0x8c, 0x3b, 0x01]);
      else if (sub === 0x3c) reply(0x3c, [0x8c, 0x3c, ...f32(120), ...f32(35.5), ...f32(0.12), ...f32(8.33)]);
      else if (sub === 0x3a && !opts.silentWave) reply(0x3a, [0x8c, 0x3a, ...Array.from({ length: 400 }, (_, i) => [i & 0xff, i >> 8]).flat()].slice(0, 802));
    },
  };
  return { conn, sent };
}

test('captures one flicker snapshot and stops flicker mode', async () => {
  const { conn, sent } = fakeConn();
  const f = await captureFlickerOnce(conn, () => {});
  expect(f).not.toBeNull();
  expect(f!.frequencyHz).toBeCloseTo(120, 1);
  expect(f!.percentFlicker).toBeCloseTo(35.5, 1);
  expect(f!.waveform).toHaveLength(400);
  expect(f!.sampleIdx).toBe(7);
  expect(f!.gear).toBe(1);
  expect(sent).toContain('8c 0e 04');
  expect(sent.filter((c) => c === '8c 25').length).toBeGreaterThanOrEqual(1);
});

test('returns null (never throws) when the waveform never arrives', async () => {
  const { conn } = fakeConn({ silentWave: true });
  const f = await captureFlickerOnce(conn, () => {});
  expect(f).toBeNull();
}, 30000);

test('shared CSV includes the flicker block, the upload CSV does not', () => {
  const result: any = {
    deviceName: 'HPCS-330P-1', spectrum: [{ nm: 400, value: 1 }, { nm: 401, value: 2 }], integrationTimeMs: 10, peakSignal: 5, darkSignal: 0,
    cct: 4000, ra: 90, duv: 0, x: 0.3, y: 0.3, lux: 10,
    flicker: { frequencyHz: 120, percentFlicker: 35.5, flickerIndex: 0.12, cycleMs: 8.33, spanMs: 500, sampleIdx: 7, gear: 1, waveform: [1, 2, 3] },
  };
  const shared = buildShareCsv(result);
  expect(shared).toContain('FlickerFrequencyHz,120.00');
  expect(shared).toContain('FlickerWaveform,1,2,3');
  expect(buildCsv(result)).not.toContain('Flicker');
});
