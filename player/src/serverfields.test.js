import { describe, it, expect } from 'vitest';
import { serverFieldsError } from './logic.js';

describe('serverFieldsError', () => {
  it('takes an http(s) server and a plain TV name', () => {
    expect(serverFieldsError('http://10.0.0.2:5002', 'dormitorio')).toBe('');
    expect(serverFieldsError('https://example.org/api', 'tv-2')).toBe('');
  });
  it('takes empty fields: the build values stay', () => {
    expect(serverFieldsError('', '')).toBe('');
  });
  it('refuses a server without http(s)://', () => {
    expect(serverFieldsError('10.0.0.2:5002', '')).toMatch(/http/);
    expect(serverFieldsError('http://', '')).toMatch(/http/);
  });
  it('refuses a TV name that is not a plain word', () => {
    expect(serverFieldsError('', '../etc')).toMatch(/TV name/);
    expect(serverFieldsError('', 'Dormitorio')).toMatch(/TV name/);
    expect(serverFieldsError('', 'mi tele')).toMatch(/TV name/);
  });
});
