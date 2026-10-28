import { gridStep, gridLabelEvery, gridLevel } from '../src/utils/runtimeGrid';

describe('gridStep', () => {
  it('is 50 lm up to 1500, 100 up to 3000, then 200 ...', () => {
    expect(gridStep(1000)).toBe(50);
    expect(gridStep(1500)).toBe(50);
    expect(gridStep(2000)).toBe(100);
    expect(gridStep(3000)).toBe(100);
    expect(gridStep(5000)).toBe(200);
    expect(gridStep(12000)).toBe(500);
  });
  it('is finer for dim lights', () => {
    expect(gridStep(300)).toBe(10);
    expect(gridStep(100)).toBe(5);
  });
  it('never gives more than 30 lines', () => {
    for (const y of [1, 5, 20, 99, 150, 299, 301, 899, 3100, 7000, 25000, 250000]) {
      expect(y / gridStep(y)).toBeLessThanOrEqual(30.0001);
    }
  });
});

describe('gridLevel', () => {
  it('gives 50 faint dots, 100 dotted and 500 solid', () => {
    expect(gridLevel(50, 50).level).toBe(0);
    expect(gridLevel(100, 50).level).toBe(1);
    expect(gridLevel(250, 50).level).toBe(0);
    expect(gridLevel(500, 50).level).toBe(3);
    expect(gridLevel(1000, 50).level).toBe(3);
    expect(gridLevel(200, 100).level).toBe(1);
    expect(gridLevel(5000, 500).level).toBe(3);
    expect(gridLevel(1000, 500).level).toBe(1);
    expect(gridLevel(500, 500).level).toBe(0);
  });
});

describe('gridLabelEvery', () => {
  it('labels every line when there is room, and thins them out when there is not', () => {
    expect(gridLabelEvery(30)).toBe(1);
    expect(gridLabelEvery(12)).toBe(2);
    expect(gridLabelEvery(5.7)).toBe(5);
    expect(gridLabelEvery(2)).toBe(20);
  });
});
