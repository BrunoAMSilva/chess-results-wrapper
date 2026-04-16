import { describe, it, expect } from 'vitest';
import {
  mapResultToUploadCode,
  buildUploadXml,
  parseUploadResponse,
} from '../../src/lib/chess-results-upload';

// ── mapResultToUploadCode ────────────────────────────────────────────────────

describe('mapResultToUploadCode', () => {
  it('maps 1-0 to "1"', () => {
    expect(mapResultToUploadCode('1-0')).toBe('1');
  });

  it('maps 0-1 to "0"', () => {
    expect(mapResultToUploadCode('0-1')).toBe('0');
  });

  it('maps ½-½ to "x"', () => {
    expect(mapResultToUploadCode('½-½')).toBe('x');
  });

  it('maps +:- to "+"', () => {
    expect(mapResultToUploadCode('+:-')).toBe('+');
  });

  it('maps -:+ to "-"', () => {
    expect(mapResultToUploadCode('-:+')).toBe('-');
  });

  it('maps -:- to "D"', () => {
    expect(mapResultToUploadCode('-:-')).toBe('D');
  });

  it('returns empty string for unknown result', () => {
    expect(mapResultToUploadCode('unknown')).toBe('');
  });
});

// ── buildUploadXml ───────────────────────────────────────────────────────────

describe('buildUploadXml', () => {
  it('produces XML with curly braces instead of angle brackets', () => {
    const xml = buildUploadXml('abc123def456abc123def456abc123de', '1361358', 3, 42, '1');
    expect(xml).not.toContain('<');
    expect(xml).not.toContain('>');
    expect(xml).toContain('{?xml');
    expect(xml).toContain('{Pairing}');
    expect(xml).toContain('{/Pairing}');
  });

  it('includes all required fields', () => {
    const sid = 'aabbccdd11223344aabbccdd11223344';
    const xml = buildUploadXml(sid, '1361358', 5, 99, 'x');
    expect(xml).toContain(`sid="${sid}"`);
    expect(xml).toContain('Tournament="1361358"');
    expect(xml).toContain('Round="5"');
    expect(xml).toContain('Uid="99"');
    expect(xml).toContain('Result="x"');
  });

  it('produces self-closing data element', () => {
    const xml = buildUploadXml('a'.repeat(32), '123', 1, 1, '1');
    expect(xml).toMatch(/\{data .* \/\}/);
  });
});

// ── parseUploadResponse ──────────────────────────────────────────────────────

describe('parseUploadResponse', () => {
  it('parses OK response', () => {
    const xml = '<UpdatePairing><data status="OK" statusMsg=""/></UpdatePairing>';
    const result = parseUploadResponse(xml);
    expect(result.status).toBe('OK');
    expect(result.statusMsg).toBe('');
  });

  it('parses ERROR response with message', () => {
    const xml =
      '<UpdatePairing><data status="ERROR" statusMsg="Invalid SID"/></UpdatePairing>';
    const result = parseUploadResponse(xml);
    expect(result.status).toBe('ERROR');
    expect(result.statusMsg).toBe('Invalid SID');
  });

  it('parses WARNING response', () => {
    const xml =
      '<UpdatePairing><data status="WARNING" statusMsg="Result already exists"/></UpdatePairing>';
    const result = parseUploadResponse(xml);
    expect(result.status).toBe('WARNING');
    expect(result.statusMsg).toBe('Result already exists');
  });

  it('returns ERROR for malformed response', () => {
    const result = parseUploadResponse('garbage');
    expect(result.status).toBe('ERROR');
    expect(result.statusMsg).toBe('Unknown response');
  });
});
