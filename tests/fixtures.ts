import type { GradingResult, Rubric } from '../shared/types.ts';

export const rubric: Rubric = {
  id: '2026-national-A',
  version: 1,
  title: '2026 전국 · Module A',
  max: { subjective: 7, objective: 4 },
  items: [
    { id: 'S1', type: 'subjective', title: '프로토타입 일치도', points: 2, step: 0.05, guide: '배치와 색이 같은가' },
    { id: 'S2', type: 'subjective', title: '완성도', points: 5 },
    {
      id: 'O3', type: 'objective', title: '이름 입력 검증', points: 2, allOrNothing: true,
      checks: [
        { id: 'O3-1', text: '빈 값이면 오류 문구' },
        { id: 'O3-2', text: '1자면 오류 문구' },
      ],
    },
    { id: 'O4', type: 'objective', title: '로그인 이동', points: 2 },
  ],
};

export function goodResult(): GradingResult {
  return {
    format: 'grading-result/1',
    rubric: '2026-national-A@1',
    participant: '이영재',
    target: '2026-reg-lyj',
    items: [
      { id: 'S1', score: 1.5, comment: { issue: '간격이 좁음', evidence: ['28_confirm.png'], fix: '16dp로 맞추기' } },
      { id: 'S2', score: 5 },
      { id: 'O3', score: 0, failed: ['O3-1'], comment: { issue: '빈 값 오류 없음', evidence: ['06_empty.png'], fix: '빈 값 검사 추가' } },
      { id: 'O4', score: 2 },
    ],
    notes: [{ kind: 'proto', title: '대조', body: '본문', images: ['prototype/a.png', '28_confirm.png'] }],
    screenshots: [{ file: '05_name.png', caption: '이름 화면' }],
  };
}

export const files = new Set(['28_confirm.png', '06_empty.png', 'prototype/a.png', '05_name.png']);
