import { TK_LIMITS_DEFAULT, TkRunGuard, parseTkLimit } from '../src/ble/tklamp';

describe('parseTkLimit', () => {
  it('reads numbers, blank as off, and rejects junk', () => {
    expect(parseTkLimit('')).toBeNull();
    expect(parseTkLimit('  ')).toBeNull();
    expect(parseTkLimit('30')).toBe(30);
    expect(parseTkLimit('7,5')).toBe(7.5);
    expect(parseTkLimit('abc')).toBeUndefined();
    expect(parseTkLimit('-3')).toBeUndefined();
  });
});

describe('TkRunGuard', () => {
  it('defaults: nothing starts or stops it except 5 minutes of silence', () => {
    const g = new TkRunGuard(TK_LIMITS_DEFAULT);
    expect(g.shouldStart(0)).toBe(true);
    expect(g.onReading(5, 0)).toBeNull();
    expect(g.onTimer(3600, 299_000)).toBeNull();
    expect(g.onTimer(3600, 300_000)).toMatch(/No readings for 5 minutes/);
  });

  it('waits for the start level', () => {
    const g = new TkRunGuard({ ...TK_LIMITS_DEFAULT, startAtLm: 100 });
    expect(g.shouldStart(99.9)).toBe(false);
    expect(g.shouldStart(100)).toBe(true);
  });

  it('stops below the level only after it has been above, and only after the hold time', () => {
    const g = new TkRunGuard({ ...TK_LIMITS_DEFAULT, stopBelowLm: 50 });
    expect(g.onReading(10, 0)).toBeNull();          // light not on yet: no stop
    expect(g.onReading(10, 10_000)).toBeNull();
    expect(g.onReading(200, 11_000)).toBeNull();    // now above
    expect(g.onReading(40, 12_000)).toBeNull();     // below, hold starts
    expect(g.onReading(40, 14_900)).toBeNull();
    expect(g.onReading(40, 15_000)).toMatch(/below 50 lm/);
  });

  it('a recovery above the level resets the hold', () => {
    const g = new TkRunGuard({ ...TK_LIMITS_DEFAULT, stopBelowLm: 50 });
    g.onReading(200, 0);
    expect(g.onReading(40, 1000)).toBeNull();
    expect(g.onReading(60, 2000)).toBeNull();       // back above
    expect(g.onReading(40, 3000)).toBeNull();       // new hold starts here
    expect(g.onReading(40, 5900)).toBeNull();
    expect(g.onReading(40, 6000)).not.toBeNull();
  });

  it('stops at the time limit, and idle 0 means off', () => {
    const g = new TkRunGuard({ startAtLm: null, stopBelowLm: null, durationMin: 30, idleMin: 0 });
    expect(g.onTimer(1799, 0)).toBeNull();
    expect(g.onTimer(1800, 0)).toMatch(/30 minute time limit/);
    expect(g.onTimer(10, 3_600_000)).toBeNull();
  });

  it('reset clears the stop-level memory for the next run', () => {
    const g = new TkRunGuard({ ...TK_LIMITS_DEFAULT, stopBelowLm: 50 });
    g.onReading(200, 0);
    g.reset();
    expect(g.onReading(10, 1000)).toBeNull();
    expect(g.onReading(10, 9000)).toBeNull();
  });
});
