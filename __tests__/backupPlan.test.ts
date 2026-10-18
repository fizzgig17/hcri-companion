import { fingerprint, planBackup, isRestorableReading, readingItem, flickerItem, flickerBackupId, isFlickerBackupId } from '../src/hcri/backupPlan';

const reading = (id: string, label = 'x', extra: any = {}): any => ({
  id,
  label,
  savedAt: 1000,
  result: { spectrum: [1, 2, 3] },
  ...extra,
});

describe('fingerprint', () => {
  it('is stable and changes when the reading is edited', () => {
    const a = reading('a');
    expect(fingerprint(a)).toBe(fingerprint(reading('a')));
    expect(fingerprint(a)).not.toBe(fingerprint(reading('a', 'renamed')));
    expect(fingerprint(a)).not.toBe(fingerprint(reading('a', 'x', { reportId: 5 })));
  });
});

describe('planBackup', () => {
  it('sends everything the first time (catch-up after signing in)', () => {
    const h = [reading('a'), reading('b')];
    const p = planBackup(h.map(readingItem), { synced: {}, pendingDelete: [] });
    expect(p.upload.map((r) => r.id)).toEqual(['a', 'b']);
    expect(p.deleteIds).toEqual([]);
  });
  it('sends only new or edited readings', () => {
    const a = reading('a');
    const b = reading('b');
    const synced = { a: fingerprint(a), b: fingerprint(b) };
    expect(planBackup([a, b].map(readingItem), { synced, pendingDelete: [] }).upload).toEqual([]);
    const b2 = reading('b', 'renamed');
    expect(planBackup([a, b2].map(readingItem), { synced, pendingDelete: [] }).upload.map((r) => r.id)).toEqual(['b']);
  });
  it('passes on deletions and never re-sends a deleted reading', () => {
    const a = reading('a');
    const p = planBackup([a].map(readingItem), { synced: {}, pendingDelete: ['a', 'z'] });
    expect(p.upload).toEqual([]);
    expect(p.deleteIds).toEqual(['a', 'z']);
  });
});

describe('isRestorableReading', () => {
  it('accepts a normal reading', () => expect(isRestorableReading(reading('a'))).toBe(true));
  it('rejects malformed items', () => {
    expect(isRestorableReading(null)).toBe(false);
    expect(isRestorableReading({ id: 'a' })).toBe(false);
    expect(isRestorableReading({ ...reading('a'), result: {} })).toBe(false);
    expect(isRestorableReading({ ...reading('a'), savedAt: 'x' })).toBe(false);
  });
});

describe('saved flickers in the backup', () => {
  const fl = { id: '17-ab', savedAt: 5, label: 'f', flicker: { frequencyHz: 120, percentFlicker: 10, flickerIndex: 0.03, cycleMs: 8, waveform: [1, 2] } };
  it('use a prefixed id so they never collide with readings', () => {
    expect(flickerBackupId('17-ab')).toBe('fl_17-ab');
    expect(isFlickerBackupId('fl_17-ab')).toBe(true);
    expect(isFlickerBackupId('17-ab')).toBe(false);
    expect(flickerItem(fl).id).toBe('fl_17-ab');
  });
  it('are planned together with readings and a delete of a flicker is by its prefixed id', () => {
    const p = planBackup([readingItem(reading('a')), flickerItem(fl)], { synced: {}, pendingDelete: ['fl_gone'] });
    expect(p.upload.map((i) => i.id)).toEqual(['a', 'fl_17-ab']);
    expect(p.deleteIds).toEqual(['fl_gone']);
  });
});
