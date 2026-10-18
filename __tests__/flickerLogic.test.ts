import { flickersForReading, flickerAssociation, attachedReading, trimFlickers, FLICKER_LIMIT, isRestorableFlicker, SavedFlicker } from '../src/storage/flickerLogic';

const fl = (id: string, extra: Partial<SavedFlicker> = {}): SavedFlicker => ({
  id,
  label: id,
  savedAt: Number(id.replace(/\D/g, '')) || 1,
  flicker: { frequencyHz: 120, percentFlicker: 10, flickerIndex: 0.03, cycleMs: 8, waveform: [1, 2, 3] },
  ...extra,
});
const rd = (id: string, extra: any = {}): any => ({ id, result: {}, ...extra });

describe('flickersForReading', () => {
  it('offers only flickers not attached to a reading', () => {
    const readings = [rd('r1'), rd('r2')];
    const flickers = [fl('f1'), fl('f2', { readingId: 'r2' }), fl('f3')];
    expect(flickersForReading(readings[0], flickers, readings).map((f) => f.id)).toEqual(['f1', 'f3']);
  });
  it('offers nothing to a reading that already has a flicker', () => {
    const r = rd('r1', { result: { flicker: {} } });
    expect(flickersForReading(r, [fl('f1')], [r])).toEqual([]);
  });
  it('frees a flicker again when its reading was deleted', () => {
    const flickers = [fl('f1', { readingId: 'gone' })];
    expect(flickersForReading(rd('r1'), flickers, [rd('r1')]).map((f) => f.id)).toEqual(['f1']);
  });
});

describe('flickerAssociation', () => {
  it('reports the report, reading, upload or nothing', () => {
    const readings = [rd('r1', { reportId: 9 }), rd('r2')];
    expect(flickerAssociation(fl('a', { readingId: 'r1' }), readings)).toBe('report');
    expect(flickerAssociation(fl('b', { readingId: 'r2' }), readings)).toBe('reading');
    expect(flickerAssociation(fl('c', { uploaded: true }), readings)).toBe('uploaded');
    expect(flickerAssociation(fl('d'), readings)).toBe('none');
  });
  it('follows the reading when it later gets a report', () => {
    const f = fl('a', { readingId: 'r2' });
    expect(flickerAssociation(f, [rd('r2')])).toBe('reading');
    expect(flickerAssociation(f, [rd('r2', { reportId: 4 })])).toBe('report');
    expect(attachedReading(f, [rd('r2')])?.id).toBe('r2');
  });
});

describe('trimFlickers / isRestorableFlicker', () => {
  it('keeps the newest up to the limit', () => {
    const list = Array.from({ length: FLICKER_LIMIT + 5 }, (_, i) => fl(`f${1000 - i}`));
    const out = trimFlickers(list);
    expect(out.length).toBe(FLICKER_LIMIT);
    expect(out[0].id).toBe('f1000');
  });
  it('checks restored items', () => {
    expect(isRestorableFlicker(fl('f1'))).toBe(true);
    expect(isRestorableFlicker({ id: 'x' })).toBe(false);
    expect(isRestorableFlicker(null)).toBe(false);
  });
});
