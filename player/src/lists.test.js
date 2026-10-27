import { describe, it, expect } from 'vitest';
import {
  filterDisplayChannels,
  channelsByName,
  rememberRecent,
  shareContent,
  FAVORITES_GROUP,
  RECENT_GROUP,
  RECENT_MAX,
} from './logic.js';

const CHANNELS = [
  { name: 'La 1', group: 'TDT' },
  { name: 'DAZN F1', group: 'Events' },
  { name: 'DAZN F1', group: 'Sports' },
  { name: 'Cuatro', group: 'TDT' },
  { name: 'Hidden One', group: 'Adult' },
];

describe('channelsByName', () => {
  it('keeps the names order and takes the first copy of each', () => {
    const out = channelsByName(CHANNELS, ['Cuatro', 'DAZN F1']);
    expect(out.map((c) => c.name)).toEqual(['Cuatro', 'DAZN F1']);
    expect(out[1].group).toBe('Events');
  });
  it('skips names no longer in the playlist, and is null-safe', () => {
    expect(channelsByName(CHANNELS, ['Gone', 'La 1']).map((c) => c.name)).toEqual(['La 1']);
    expect(channelsByName(null, null)).toEqual([]);
  });
});

describe('filterDisplayChannels with the TV lists', () => {
  const lists = { favorites: ['La 1', 'Hidden One'], recent: ['DAZN F1', 'La 1'] };
  it('shows the favorites and the recent ones as groups, in their order', () => {
    expect(filterDisplayChannels(CHANNELS, [], FAVORITES_GROUP, lists).map((c) => c.name)).toEqual([
      'La 1',
      'Hidden One',
    ]);
    expect(filterDisplayChannels(CHANNELS, [], RECENT_GROUP, lists).map((c) => c.name)).toEqual(['DAZN F1', 'La 1']);
  });
  it('leaves out the channels of hidden groups', () => {
    expect(filterDisplayChannels(CHANNELS, ['Adult'], FAVORITES_GROUP, lists).map((c) => c.name)).toEqual(['La 1']);
  });
  it('is empty without the lists', () => {
    expect(filterDisplayChannels(CHANNELS, [], RECENT_GROUP)).toEqual([]);
  });
});

describe('rememberRecent', () => {
  it('puts the channel first, once', () => {
    expect(rememberRecent(['A', 'B', 'C'], 'B')).toEqual(['B', 'A', 'C']);
    expect(rememberRecent(null, 'A')).toEqual(['A']);
  });
  it('keeps at most RECENT_MAX', () => {
    const many = Array.from({ length: RECENT_MAX }, (_, i) => 'C' + i);
    const out = rememberRecent(many, 'New');
    expect(out).toHaveLength(RECENT_MAX);
    expect(out[0]).toBe('New');
    expect(out).not.toContain('C' + (RECENT_MAX - 1));
  });
});

describe('shareContent', () => {
  it('lists the recent channels and the favorites with their group and logo', () => {
    const list = [
      { name: 'La 1', group: 'TDT', logo: 'l1.png' },
      { name: 'DAZN F1', group: 'Events' },
    ];
    expect(shareContent(['La 1'], ['DAZN F1', 'Gone'], list, 5)).toEqual({
      updated: 5,
      recent: [{ name: 'DAZN F1', group: 'Events', logo: '' }, { name: 'Gone' }],
      favorites: [{ name: 'La 1', group: 'TDT', logo: 'l1.png' }],
      guide: {},
    });
  });
  it('is null-safe', () => {
    expect(shareContent(null, null, null, 0)).toEqual({ updated: 0, recent: [], favorites: [], guide: {} });
  });
});
