import { describe, it, expect } from 'vitest';
import { guideAddress, parseXmltvTime, guideWindow, guideFor } from './guide.js';
import { shareContent } from './logic.js';

const H = 3600000;
const T0 = Date.UTC(2026, 9, 27, 10, 0, 0); // 10:00 UTC
const XML = `<?xml version="1.0"?><tv>
<channel id="f1"><display-name>DAZN F1</display-name></channel>
<programme start="20261027090000 +0000" stop="20261027100000 +0000" channel="f1"><title>Past</title></programme>
<programme start="20261027113000 +0200" stop="20261027123000 +0200" channel="f1"><title lang="es">Libres &amp; más</title></programme>
<programme start="20261027103000 +0000" stop="20261027110000 +0000" channel="f1"><title><![CDATA[Clasificación]]></title></programme>
<programme channel="la1" stop="20261027120000 +0000" start="20261027100000 +0000"><title>Telediario</title></programme>
<programme start="20261028090000 +0000" stop="20261028100000 +0000" channel="f1"><title>Tomorrow</title></programme>
</tv>`;

describe('guideAddress', () => {
  it('reads url-tvg or x-tvg-url from the first line', () => {
    expect(guideAddress('#EXTM3U url-tvg="http://h/xmltv" refresh="3600"\n#EXTINF:-1,A\nhttp://a')).toBe(
      'http://h/xmltv',
    );
    expect(guideAddress('#EXTM3U x-tvg-url="http://a/1.xml,http://b/2.xml"\n')).toBe('http://a/1.xml');
  });
  it('is empty without one', () => {
    expect(guideAddress('#EXTM3U\n#EXTINF:-1 url-tvg="x",A\n')).toBe('');
    expect(guideAddress(null)).toBe('');
  });
});

describe('parseXmltvTime', () => {
  it('applies the offset', () => {
    expect(parseXmltvTime('20261027113000 +0200')).toBe(T0 - 0.5 * H + 0); // 09:30 UTC
    expect(parseXmltvTime('20261027100000')).toBe(T0);
    expect(parseXmltvTime('nope')).toBeNaN();
  });
});

describe('guideWindow', () => {
  const w = guideWindow(XML, T0, T0 + 12 * H);
  it('keeps the programmes overlapping the window, by start, any attribute order', () => {
    expect(w.f1.map((p) => p.t)).toEqual(['Libres & más', 'Clasificación']); // 09:30-10:30 UTC overlaps 10:00
    expect(w.la1.map((p) => p.t)).toEqual(['Telediario']);
  });
  it('decodes entities and drops what ended or starts after it', () => {
    const wide = guideWindow(XML, T0 - 2 * H, T0 + 48 * H);
    expect(wide.f1.map((p) => p.t)).toEqual(['Past', 'Libres & más', 'Clasificación', 'Tomorrow']);
    expect(guideWindow('', T0, T0 + H)).toEqual({});
  });
});

describe('guideFor and shareContent', () => {
  const channels = [
    { name: 'DAZN F1', group: 'Sports', tvgId: null },
    { name: 'DAZN F1', group: 'Events', tvgId: 'f1' },
    { name: 'La 1', group: 'TDT', tvgId: 'la1' },
    { name: 'No Guide', group: 'X', tvgId: 'none' },
  ];
  const w = guideWindow(XML, T0, T0 + 12 * H);
  it('takes the guide of the first copy with one, by name', () => {
    const g = guideFor(['DAZN F1', 'No Guide', 'La 1'], channels, w);
    expect(Object.keys(g)).toEqual(['DAZN F1', 'La 1']);
    expect(g['DAZN F1'][0].t).toBe('Libres & más');
  });
  it('adds the guide of the shared channels to the file', () => {
    const out = shareContent(['La 1'], ['DAZN F1'], channels, 7, w);
    expect(Object.keys(out.guide)).toEqual(['DAZN F1', 'La 1']);
    expect(shareContent(['La 1'], [], channels, 7).guide).toEqual({});
  });
});
