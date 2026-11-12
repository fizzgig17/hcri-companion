// Smoke test: the Lights tab asks for a token when there is none, and lists/opens lights when there is one.
let mockStore: string | null = null;
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(async () => mockStore), setItem: jest.fn(async (_k: string, v: string) => { mockStore = v; }) } }));
let mockCreds: any = null;
jest.mock('../src/storage/secureStorage', () => ({ loadHcriCredentials: async () => mockCreds, saveHcriCredentials: async () => {} }));
jest.mock('../src/storage/readingHistory', () => ({ loadHistory: async () => [], setReadingReportLink: async () => {} }));
jest.mock('../src/hcri/lightsApi', () => ({
  LIGHT_KINDS: [], checkLightsToken: async (t: string) => (t === 'good' ? 'ok' : 'invalid'),
  listServerLights: async () => ({ ok: true, data: [] }), getServerLight: async () => ({ ok: false, status: 404, error: 'x' }), deleteServerLight: async () => ({ ok: true, data: {} }),
}));
jest.mock('../src/contexts/LogContext', () => ({ useLog: () => ({ appendLog: () => {} }) }));
jest.mock('../src/contexts/ThemeContext', () => ({ useTheme: () => ({ colors: { card: '#111', cardBorder: '#333', text: '#fff', muted: '#999', mutedFaint: '#666', accent: '#09f', background: '#000' } }) }));
jest.mock('../src/components/CategorizeModal', () => () => null);
jest.mock('react-native-svg', () => { const R = require('react'); const C = (n: string) => (p: any) => R.createElement(n, p, p.children); return { __esModule: true, default: C('Svg'), Polyline: C('Polyline'), Circle: C('Circle') }; });
jest.mock('../src/hcri/generateApiToken', () => ({ generateApiToken: async () => ({ username: 'u', token: 'good' }) }));

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import LightsHistoryTab from '../src/screens/tabs/LightsHistoryTab';
import { saveLights } from '../src/storage/lightsStore';

const texts = (t: renderer.ReactTestRenderer) => JSON.stringify(t.toJSON());
const mount = async () => { let t!: renderer.ReactTestRenderer; await act(async () => { t = renderer.create(<LightsHistoryTab history={[]} lists={{ brands: [], models: [], ccts: [], modelsByBrand: {}, others: {} }} onOpenReading={() => {}} />); }); await act(async () => {}); return t; };

it('asks for a token when none is saved', async () => {
  mockCreds = null; await saveLights([]);
  expect(texts(await mount())).toContain('Sign in to use Lights');
});
it('says the token is not valid when the server rejects it', async () => {
  mockCreds = { username: 'u', token: 'bad' };
  expect(texts(await mount())).toContain('token is not valid');
});
it('lists lights and opens one when the token works', async () => {
  mockCreds = { username: 'u', token: 'good' };
  await saveLights([{ id: 'l1', name: 'Zebralight SC64', notes: '', cats: { light_brand: ['Zebralight'] }, readingIds: [], removedReportIds: [], dirty: true, createdAt: 1 }]);
  const t = await mount();
  expect(texts(t)).toContain('Zebralight SC64');
  expect(texts(t)).toContain('Not on hCRI.io yet');
  let node: any = t.root.findAll((n) => n.props.children === 'Zebralight SC64')[0];
  while (node && typeof node.props.onPress !== 'function') node = node.parent;
  const card = node;
  await act(async () => { card.props.onPress(); });
  expect(texts(t)).toContain('Upload light to hCRI.io');
  expect(texts(t)).toContain('Add readings');
});
