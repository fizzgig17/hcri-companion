import { isNewerIosBuild, parseProdIosBuild } from '../src/utils/iosUpdateLogic';

test('reads the build and version from the release body', () => {
  expect(parseProdIosBuild({ name: 'iOS production build 42', body: 'Published.\nbuild: 42\nversion: 1.28\n' })).toEqual({ build: 42, version: '1.28' });
  expect(parseProdIosBuild({ body: 'build: 7' })).toEqual({ build: 7, version: '' });
  expect(parseProdIosBuild({ body: 'nothing here' })).toBeNull();
  expect(parseProdIosBuild(null)).toBeNull();
});

test('only a higher published build counts as an update', () => {
  expect(isNewerIosBuild('41', 42)).toBe(true);
  expect(isNewerIosBuild('42', 42)).toBe(false);
  expect(isNewerIosBuild('43', 42)).toBe(false);
  expect(isNewerIosBuild('', 42)).toBe(false);
  expect(isNewerIosBuild(41, 42)).toBe(true);
});
