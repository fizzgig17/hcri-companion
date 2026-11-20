describe('navBar', () => {
  afterEach(() => jest.resetModules());

  it('defaults to auto and reads docked from the native module', async () => {
    jest.doMock('react-native', () => ({
      Platform: { OS: 'android' },
      NativeModules: { NavBar: { getMode: jest.fn().mockResolvedValue('docked'), setMode: jest.fn().mockResolvedValue(undefined) } },
    }));
    const nb = require('../src/utils/navBar');
    expect(nb.navBarSupported).toBe(true);
    expect(await nb.loadNavBarMode()).toBe('docked');
  });

  it('falls back to auto when the native module is missing or fails', async () => {
    jest.doMock('react-native', () => ({ Platform: { OS: 'ios' }, NativeModules: {} }));
    const nb = require('../src/utils/navBar');
    expect(nb.navBarSupported).toBe(false);
    expect(await nb.loadNavBarMode()).toBe('auto');
  });

  it('saves the chosen mode through the native module', async () => {
    const setMode = jest.fn().mockResolvedValue(undefined);
    jest.doMock('react-native', () => ({ Platform: { OS: 'android' }, NativeModules: { NavBar: { getMode: jest.fn(), setMode } } }));
    const nb = require('../src/utils/navBar');
    await nb.saveNavBarMode('docked');
    expect(setMode).toHaveBeenCalledWith('docked');
  });
});
