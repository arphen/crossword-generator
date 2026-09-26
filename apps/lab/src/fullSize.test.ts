import { describe, expect, it } from 'vitest';
import {
  isLocalRequest,
  parseGenerateOptions,
  validateGeneratedGrid,
} from '../server';
import sample from './sample-grid.json';

describe('15×15 construction boundary', () => {
  it('accepts the bundled engine-generated, fully checked grid', () => {
    const grid = validateGeneratedGrid(sample);
    expect(grid.fill).toHaveLength(15);
    expect(grid.entries.length).toBeGreaterThanOrEqual(72);
    expect(grid.entries.length).toBeLessThanOrEqual(78);
    expect(grid.iffy).toBe(0);
  });

  it('rejects a broken crossing', () => {
    const broken = structuredClone(sample);
    broken.entries[0]!.answer = 'XXXX';
    expect(() => validateGeneratedGrid(broken)).toThrow(/crossings/);
  });

  it('rejects asymmetric blocks and unchecked cells', () => {
    const asymmetry = structuredClone(sample);
    asymmetry.template[0] = `#${asymmetry.template[0]!.slice(1)}`;
    expect(() => validateGeneratedGrid(asymmetry)).toThrow();
    const unchecked = structuredClone(sample);
    unchecked.entries.pop();
    expect(() => validateGeneratedGrid(unchecked)).toThrow(/Every white cell/);
  });

  it('bounds costly generation requests and validates themes', () => {
    expect(parseGenerateOptions({}).candidates).toBe(80);
    expect(parseGenerateOptions({}).minScore).toBe(60);
    expect(() => parseGenerateOptions({ candidates: 10_000 })).toThrow(
      /candidates/,
    );
    expect(() => parseGenerateOptions({ minScore: 90 })).toThrow(/minScore/);
    expect(() => parseGenerateOptions({ themes: ['ABCDEFGHIJKL'] })).toThrow(
      /theme/,
    );
    expect(parseGenerateOptions({ themes: ['HOMERUN'] }).themes).toEqual([
      'HOMERUN',
    ]);
  });

  it('keeps the local construction API on loopback origins', () => {
    expect(isLocalRequest('localhost:5173', 'http://localhost:5173')).toBe(
      true,
    );
    expect(isLocalRequest('127.0.0.1:5173')).toBe(true);
    expect(isLocalRequest('evil.example:5173')).toBe(false);
    expect(isLocalRequest('localhost:5173', 'https://evil.example')).toBe(
      false,
    );
  });
});
