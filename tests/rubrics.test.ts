import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Rubric } from '../shared/types.ts';
import { validateRubric } from '../shared/validate.ts';

// 공식 2026 전국기능경기대회 채점기준표(모바일앱개발)에서 옮긴 기준표. 합계가 공식 배점과 같아야 한다.
const EXPECTED: Record<string, [number, number]> = { a: [5, 25], b: [7, 28], c: [3, 32] };

describe.each(Object.entries(EXPECTED))('2026 전국 Module %s 기준표', (key, [sub, obj]) => {
  const rubric = JSON.parse(readFileSync(new URL(`../rubrics/2026-national-${key}.json`, import.meta.url), 'utf8')) as Rubric;
  it('형식이 올바르다', () => {
    expect(validateRubric(rubric)).toEqual([]);
  });
  it('주관/객관 합계가 공식 배점과 같다', () => {
    expect(rubric.max).toEqual({ subjective: sub, objective: obj });
    const sum = (t: string) => rubric.items.filter((i) => i.type === t).reduce((a, i) => a + i.points, 0);
    expect(sum('subjective')).toBeCloseTo(sub, 6);
    expect(sum('objective')).toBeCloseTo(obj, 6);
  });
});
