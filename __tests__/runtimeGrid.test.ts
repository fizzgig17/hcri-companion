import { gridStep, gridLabelEvery } from '../src/utils/runtimeGrid';

describe('gridStep', () => {
  it('is 100 lumens for ordinary lights', () => {
    expect(gridStep(300)).toBe(100);
    expect(gridStep(1000)).toBe(100);
    expect(gridStep(2500)).toBe(100);
    expect(gridStep(3000)).toBe(100);
  });
  it('uses a round spacing for dim and very bright lights', () => {
    expect(gridStep(100)).toBe(20);
    expect(gridStep(250)).toBe(50);
    expect(gridStep(5000)).toBe(200);
    expect(gridStep(10000)).toBe(500);
    expect(gridStep(100000)).toBe(5000);
  });
  it('never gives more than 30 lines or fewer than 3 for sensible ranges', () => {
    for (const y of [1, 5, 20, 99, 150, 299, 301, 899, 3100, 7000, 25000, 250000]) {
      const lines = y / gridStep(y);
      expect(lines).toBeLessThanOrEqual(30.0001);
      expect(lines).toBeGreaterThanOrEqual(3);
    }
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
