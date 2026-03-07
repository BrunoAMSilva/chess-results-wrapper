import { describe, it, expect } from 'vitest';
import { reverseName } from '../../src/lib/utils';

describe('reverseName', () => {
  it('should reverse comma-separated "Last, First"', () => {
    expect(reverseName('Silva, Bruno')).toBe('Bruno Silva');
  });

  it('should reverse "LAST First" format', () => {
    expect(reverseName('SILVA Bruno')).toBe('Bruno SILVA');
  });

  it('should handle multi-word last names', () => {
    expect(reverseName('MARTINEZ RAMIREZ Lennis')).toBe('Lennis MARTINEZ RAMIREZ');
  });

  it('should handle Portuguese compound names', () => {
    expect(reverseName('Silva, Bruno Alexandre Martins da')).toBe('Bruno Alexandre Martins da Silva');
  });

  it('should handle empty string', () => {
    expect(reverseName('')).toBe('');
  });

  it('should handle single word name', () => {
    expect(reverseName('Madonna')).toBe('Madonna');
  });

  it('should handle all-uppercase name without splitting', () => {
    expect(reverseName('SILVA')).toBe('SILVA');
  });

  it('should handle comma-separated with spaces', () => {
    expect(reverseName('FONTELAS, Diogo Rebelo')).toBe('Diogo Rebelo FONTELAS');
  });
});
