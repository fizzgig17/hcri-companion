import { fingerprint, planBackup, isRestorableReading } from '../src/hcri/backupPlan';

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
    const p = planBackup(h, { synced: {}, pendingDelete: [] });
    expect(p.upload.map((r) => r.id)).toEqual(['a', 'b']);
    expect(p.deleteIds).toEqual([]);
  });
  it('sends only new or edited readings', () => {
    const a = reading('a');
    const b = reading('b');
    const synced = { a: fingerprint(a), b: fingerprint(b) };
    expect(planBackup([a, b], { synced, pendingDelete: [] }).upload).toEqual([]);
    const b2 = reading('b', 'renamed');
    expect(planBackup([a, b2], { synced, pendingDelete: [] }).upload.map((r) => r.id)).toEqual(['b']);
  });
  it('passes on deletions and never re-sends a deleted reading', () => {
    const a = reading('a');
    const p = planBackup([a], { synced: {}, pendingDelete: ['a', 'z'] });
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
