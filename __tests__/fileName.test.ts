import { asciiFileName } from '../src/utils/fileName';

describe('asciiFileName', () => {
  it('drops accents instead of replacing the letter', () => {
    expect(asciiFileName('Kōsen Müller')).toBe('Kosen_Muller');
  });
  it('replaces unsafe characters', () => {
    expect(asciiFileName('a/b: c')).toBe('a_b_c');
  });
});
