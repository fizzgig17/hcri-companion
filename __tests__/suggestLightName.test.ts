jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(), setItem: jest.fn() } }));
import { suggestLightName } from '../src/components/AddToLightModal';
it('suggests the shared start of the labels', () => {
  expect(suggestLightName(['Zebralight SC64 high', 'Zebralight SC64 low', 'Zebralight SC64 med'])).toBe('Zebralight SC64');
  expect(suggestLightName(['Zebralight SC64 - H', 'Zebralight SC64 - L'])).toBe('Zebralight SC64');
});
it('suggests nothing for auto-made labels, one reading, or no overlap', () => {
  expect(suggestLightName(['Reading 2026-11-12 06:10', 'Reading 2026-11-12 06:11'])).toBe('');
  expect(suggestLightName(['Zebralight SC64'])).toBe('');
  expect(suggestLightName(['Convoy S2', 'Zebralight'])).toBe('');
});
