import { describe, expect, it } from 'vitest';
import { computeScores, referencedFiles, validateResult, validateRubric } from '../shared/validate.ts';
import { buildInstructionPrompt } from '../shared/prompt.ts';
import { files, goodResult, rubric } from './fixtures.ts';

const ctx = { rubric, uploadedFiles: files, participantNames: ['이영재', '김철수'] };
const msgs = (r: unknown, c = ctx) => validateResult(r, c).map((i) => `${i.path}: ${i.message}`);

describe('validateRubric', () => {
  it('정상 기준표는 통과한다', () => expect(validateRubric(rubric)).toEqual([]));
  it('배점 합계가 만점과 다르면 막는다', () => {
    const bad = structuredClone(rubric);
    bad.max.objective = 5;
    expect(validateRubric(bad).map((i) => i.message).join()).toContain('객관 항목의 배점 합계');
  });
  it('겹치는 id와 잘못된 type을 막는다', () => {
    const bad = structuredClone(rubric) as any;
    bad.items[1].id = 'S1';
    bad.items[3].type = 'x';
    const m = validateRubric(bad).map((i) => i.message).join('|');
    expect(m).toContain('id가 겹칩니다');
    expect(m).toContain('subjective 또는 objective');
  });
  it('객체가 아니면 막는다', () => expect(validateRubric([])).toHaveLength(1));
});

describe('validateResult', () => {
  it('정상 결과는 통과한다', () => expect(validateResult(goodResult(), ctx)).toEqual([]));
  it('format과 rubric 버전이 틀리면 막는다', () => {
    const r: any = goodResult();
    r.format = 'x';
    r.rubric = '2026-national-A@2';
    expect(msgs(r)).toHaveLength(2);
  });
  it('없는 id, 빠진 id, 중복 id를 막는다', () => {
    const r: any = goodResult();
    r.items = [r.items[0], r.items[0], { id: 'ZZ', score: 1 }, r.items[2]];
    const m = msgs(r).join('|');
    expect(m).toContain('두 번 나왔습니다');
    expect(m).toContain('기준표에 없는 항목');
    expect(m).toContain('S2');
    expect(m).toContain('O4');
  });
  it('점수 범위와 단위를 막는다', () => {
    const r: any = goodResult();
    r.items[0].score = 2.5;
    expect(msgs(r).join()).toContain('이하여야');
    r.items[0].score = 1.234;
    expect(msgs(r).join()).toContain('단위');
    r.items[0].score = 1.55;
    expect(msgs(r).join()).not.toContain('단위');
  });
  it('전부/전무 항목은 0 또는 만점만 허용한다', () => {
    const r: any = goodResult();
    r.items[3].score = 1;
    expect(msgs(r).join()).toContain('전부/전무');
  });
  it('failed가 있으면 전부/전무 항목은 0점이어야 한다', () => {
    const r: any = goodResult();
    r.items[2].score = 2;
    const m = msgs(r).join('|');
    expect(m).toContain('0점이어야');
    expect(m).toContain('failed가 비어');
  });
  it('failed에 없는 확인 사항 id를 막는다', () => {
    const r: any = goodResult();
    r.items[2].failed = ['O3-9'];
    expect(msgs(r).join()).toContain('확인 사항 id가 아닙니다');
  });
  it('깎인 항목은 코멘트 세 칸이 모두 있어야 한다', () => {
    const r: any = goodResult();
    delete r.items[0].comment;
    expect(msgs(r).join()).toContain('comment');
    r.items[0].comment = { issue: '', evidence: [], fix: '' };
    expect(msgs(r)).toHaveLength(3);
  });
  it('코멘트는 120자를 넘으면 안 된다', () => {
    const r: any = goodResult();
    r.items[0].comment.issue = 'a'.repeat(121);
    expect(msgs(r).join()).toContain('120자');
  });
  it('만점 항목은 코멘트를 생략할 수 있다', () => expect(msgs(goodResult())).toEqual([]));
  it('올라오지 않은 파일과 대소문자 차이를 막는다', () => {
    const r: any = goodResult();
    r.items[0].comment.evidence = ['28_Confirm.png'];
    r.screenshots = [{ file: 'nope.png' }];
    r.notes[0].images = ['prototype/b.png'];
    const m = msgs(r).join('|');
    expect(m).toContain('대소문자');
    expect(m).toContain('nope.png');
    expect(m).toContain('prototype/b.png');
  });
  it('등록되지 않은 참가자를 막는다', () => {
    const r: any = goodResult();
    r.participant = '홍길동';
    expect(msgs(r).join()).toContain('등록된 참가자가 아닙니다');
  });
  it('파일 목록과 참가자 목록을 안 주면 그 검사는 건너뛴다', () => {
    const r: any = goodResult();
    r.participant = '홍길동';
    r.screenshots = [{ file: 'nope.png' }];
    expect(validateResult(r, { rubric })).toEqual([]);
  });
  it('JSON이 객체가 아니면 막는다', () => expect(validateResult('x', ctx)).toHaveLength(1));
});

describe('computeScores', () => {
  it('항목 점수로 합계와 감점을 계산한다', () => {
    const s = computeScores(rubric, goodResult());
    expect(s).toMatchObject({ subjective: 6.5, objective: 2, total: 8.5, maxTotal: 11, deduction: 2.5 });
  });
  it('0.05 단위 합계가 오차 없이 나온다', () => {
    const r = goodResult();
    r.items[0]!.score = 0.1;
    r.items[1]!.score = 0.2;
    expect(computeScores(rubric, r).subjective).toBe(0.3);
  });
});

describe('referencedFiles', () => {
  it('참조 파일을 중복 없이 모은다', () => {
    expect(referencedFiles(goodResult()).sort()).toEqual(['05_name.png', '06_empty.png', '28_confirm.png', 'prototype/a.png']);
  });
});

describe('buildInstructionPrompt', () => {
  it('기준표, 형식, 코멘트 규칙, 작업 순서를 담는다', () => {
    const p = buildInstructionPrompt({
      contestName: '2026 전국', moduleCode: 'A', moduleFolder: 'module-a', rubric,
      participants: [{ name: '이영재', repo: '2026-reg-lyj' }],
    });
    expect(p).toContain('2026-national-A@1');
    expect(p).toContain('grading-result/1');
    expect(p).toContain('O3-1');
    expect(p).toContain('120자');
    expect(p).toContain('빌드');
    expect(p).toContain('이영재');
    expect(p).toContain('module-a/');
  });
});
