import { SecondBinner, LiveRelay } from '../src/hcri/liveRelay';

describe('SecondBinner', () => {
  it('averages readings into one value per second', () => {
    const b = new SecondBinner();
    b.add(1000, 100); b.add(1400, 200); b.add(2100, 300); b.add(3200, 400);
    b.flushPartial();
    expect(b.values).toEqual([150, 300, 400]);
  });
  it('repeats the last value across a gap so the time axis stays true', () => {
    const b = new SecondBinner();
    b.add(0, 10); b.add(4500, 20);
    b.flushPartial();
    expect(b.values).toEqual([10, 10, 10, 10, 20]);
  });
  it('ignores bad numbers', () => {
    const b = new SecondBinner();
    b.add(0, NaN); b.add(0, 5); b.flushPartial();
    expect(b.values).toEqual([5]);
  });
});

describe('LiveRelay', () => {
  const mk = (server: { count: number }, calls: any[] = []) =>
    new LiveRelay('r1', () => 'My run', async (body: any) => {
      calls.push(body);
      if (body.startIndex > server.count) return { count: server.count, resend: true };
      server.count = body.startIndex + body.values.length;
      return { count: server.count };
    });
  const feed = (r: LiveRelay, n: number, from = 0) => { for (let i = 0; i < n; i += 1) r.add((from + i) * 1000, 500 + i); r.bins.flushPartial(); };

  it('sends only what the server does not have', async () => {
    const server = { count: 0 }; const calls: any[] = [];
    const r = mk(server, calls);
    feed(r, 5);
    expect(await r.flush()).toBe(true);
    expect(server.count).toBe(5);
    expect(await r.flush()).toBe(true);   // nothing new: no request
    expect(calls).toHaveLength(1);
  });
  it('resends from where the server stopped when it is behind', async () => {
    const server = { count: 0 }; const calls: any[] = [];
    const r = mk(server, calls);
    feed(r, 3);
    await r.flush();
    server.count = 1;   // the server lost two readings
    feed(r, 2, 3);
    await r.flush();
    expect(server.count).toBe(5);
  });
  it('keeps the readings when a send fails and sends them next time', async () => {
    let fail = true; const got: number[][] = [];
    const r = new LiveRelay('r1', () => 'x', async (b: any) => { if (fail) throw new Error('offline'); got.push(b.values); return { count: b.startIndex + b.values.length }; });
    feed(r, 4);
    expect(await r.flush()).toBe(false);
    fail = false;
    expect(await r.flush()).toBe(true);
    expect(got[0]).toHaveLength(4);
  });
  it('finish sends the last readings with the final status', async () => {
    const server = { count: 0 }; const calls: any[] = [];
    const r = mk(server, calls);
    r.add(0, 100); r.add(1000, 110);
    await r.finish('finished');
    expect(calls[calls.length - 1].status).toBe('finished');
    expect(server.count).toBe(2);
  });
  it('stops sending when the station was turned off', async () => {
    const calls: any[] = [];
    const r = new LiveRelay('r1', () => 'x', async (b: any) => { calls.push(b); return { count: 0, enabled: false }; });
    feed(r, 3);
    await r.flush(); await r.flush();
    expect(calls).toHaveLength(1);
  });
});
