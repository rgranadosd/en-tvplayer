import { describe, it, expect, beforeEach } from 'vitest';
import { getSettings, saveSettings, getCachedChannels, saveCachedChannels } from './config.js';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const LIST = [
  { name: 'La 1', url: 'http://a/1', group: 'TV' },
  { name: 'DAZN F1', url: 'http://a/2', group: 'Sports' },
];

describe('the channel cache, apart from the settings', () => {
  beforeEach(() => store.clear());

  it('moves the channels an earlier version kept in the settings to their own key, once', () => {
    store.set(
      'en_settings',
      JSON.stringify({ channels: LIST, channelsFetched: '2026-11-04T10:00:00Z', lastGroup: 'TV' }),
    );
    const s = getSettings();
    expect(s.channels).toBeUndefined();
    expect(s.lastGroup).toBe('TV');
    expect(JSON.parse(store.get('en_settings')).channels).toBeUndefined();
    expect(getCachedChannels()).toEqual(LIST);
  });

  it('saves the list apart, with its date in the settings', () => {
    saveCachedChannels(LIST);
    expect(getCachedChannels()).toEqual(LIST);
    expect(store.get('en_settings')).not.toContain('DAZN F1');
    expect(getSettings().channelsFetched).toBeTruthy();
  });

  it('keeps the list when other settings are saved', () => {
    saveCachedChannels(LIST);
    saveSettings({ lastChannelUrl: 'http://a/2' });
    expect(getCachedChannels()).toEqual(LIST);
    expect(store.get('en_settings')).not.toContain('DAZN F1');
  });

  it('is empty without a saved list, or with a broken one', () => {
    expect(getCachedChannels()).toEqual([]);
    store.set('en_channels', '{oops');
    expect(getCachedChannels()).toEqual([]);
  });
});
