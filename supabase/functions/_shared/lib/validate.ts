import {
  COMMENT_MAX_LENGTH,
  RESULT_FORMAT,
  type GradingResult,
  type Rubric,
  type RubricItem,
  type Scores,
  type ValidationIssue,
} from './types.ts';

const EPS = 1e-6;

/** 부동소수점 오차를 없앤다(0.05 단위 점수 합계 등). */
export function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

export function rubricRef(rubric: Pick<Rubric, 'id' | 'version'>): string {
  return `${rubric.id}@${rubric.version}`;
}

/** 객관 항목은 allOrNothing 기본값이 true, 주관 항목은 false */
export function isAllOrNothing(item: RubricItem): boolean {
  return item.allOrNothing ?? item.type === 'objective';
}

// ---------------------------------------------------------------------------
// 채점 기준표(루브릭) 검사
// ---------------------------------------------------------------------------

/** 채점 기준표 JSON을 검사한다. 문제가 없으면 빈 배열. */
export function validateRubric(input: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (path: string, message: string, itemId?: string) =>
    issues.push({ path, message, ...(itemId ? { itemId } : {}) });

  if (!isObject(input)) {
    return [{ path: '(전체)', message: '채점 기준표는 JSON 객체여야 합니다.' }];
  }
  if (!isNonEmptyString(input.id)) add('id', '기준표 id가 필요합니다.');
  if (!Number.isInteger(input.version) || (input.version as number) < 1) {
    add('version', '버전은 1 이상의 정수여야 합니다.');
  }
  if (!isNonEmptyString(input.title)) add('title', '기준표 제목이 필요합니다.');

  const max = input.max;
  let maxSub = NaN;
  let maxObj = NaN;
  if (!isObject(max) || typeof max.subjective !== 'number' || typeof max.objective !== 'number') {
    add('max', '만점(max.subjective, max.objective)이 숫자로 있어야 합니다.');
  } else {
    maxSub = max.subjective;
    maxObj = max.objective;
    if (maxSub < 0 || maxObj < 0) add('max', '만점은 0 이상이어야 합니다.');
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    add('items', '채점 항목이 하나 이상 필요합니다.');
    return issues;
  }

  const seen = new Set<string>();
  let sumSub = 0;
  let sumObj = 0;
  input.items.forEach((raw, i) => {
    const at = `items[${i}]`;
    if (!isObject(raw)) {
      add(at, '항목은 객체여야 합니다.');
      return;
    }
    const id = raw.id;
    if (!isNonEmptyString(id)) {
      add(at, '항목 id가 필요합니다.');
      return;
    }
    const where = `${at} (${id})`;
    if (seen.has(id)) add(where, '항목 id가 겹칩니다.', id);
    seen.add(id);
    if (raw.type !== 'subjective' && raw.type !== 'objective') {
      add(where, 'type은 subjective 또는 objective여야 합니다.', id);
    }
    if (!isNonEmptyString(raw.title)) add(where, '항목 제목이 필요합니다.', id);
    if (typeof raw.points !== 'number' || !(raw.points > 0)) {
      add(where, '배점은 0보다 큰 숫자여야 합니다.', id);
    } else if (raw.type === 'subjective') sumSub += raw.points;
    else if (raw.type === 'objective') sumObj += raw.points;

    if (raw.step !== undefined) {
      if (raw.type !== 'subjective') add(where, 'step은 주관 항목에만 쓸 수 있습니다.', id);
      else if (typeof raw.step !== 'number' || !(raw.step > 0)) add(where, 'step은 0보다 큰 숫자여야 합니다.', id);
    }
    if (raw.allOrNothing !== undefined && typeof raw.allOrNothing !== 'boolean') {
      add(where, 'allOrNothing은 true 또는 false여야 합니다.', id);
    }
    if (raw.checks !== undefined) {
      if (!Array.isArray(raw.checks) || raw.checks.length === 0) {
        add(where, 'checks는 하나 이상의 확인 사항이어야 합니다.', id);
      } else {
        const checkIds = new Set<string>();
        raw.checks.forEach((c, j) => {
          if (!isObject(c) || !isNonEmptyString(c.id) || !isNonEmptyString(c.text)) {
            add(`${where}.checks[${j}]`, '확인 사항에는 id와 text가 필요합니다.', id);
          } else if (checkIds.has(c.id)) {
            add(`${where}.checks[${j}]`, `확인 사항 id(${c.id})가 겹칩니다.`, id);
          } else checkIds.add(c.id);
        });
      }
    }
    if (raw.guide !== undefined && typeof raw.guide !== 'string') add(where, 'guide는 문자열이어야 합니다.', id);
  });

  if (Number.isFinite(maxSub) && Math.abs(round(sumSub) - maxSub) > EPS) {
    add('items', `주관 항목의 배점 합계(${round(sumSub)})가 만점(${maxSub})과 다릅니다.`);
  }
  if (Number.isFinite(maxObj) && Math.abs(round(sumObj) - maxObj) > EPS) {
    add('items', `객관 항목의 배점 합계(${round(sumObj)})가 만점(${maxObj})과 다릅니다.`);
  }
  return issues;
}

// ---------------------------------------------------------------------------
// 결과 JSON 검사
// ---------------------------------------------------------------------------

export interface ValidateResultContext {
  rubric: Rubric;
  /** 업로드된 파일 이름(대소문자 그대로). 없으면 파일 존재 검사를 건너뛴다 */
  uploadedFiles?: ReadonlySet<string>;
  /** 그 대회에 등록된 참가자 이름. 없으면 이름 검사를 건너뛴다 */
  participantNames?: readonly string[];
}

/** 결과 JSON 한 개를 검사한다. 화면과 submit-result Edge Function이 같은 함수를 쓴다. */
export function validateResult(input: unknown, ctx: ValidateResultContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (path: string, message: string, itemId?: string) =>
    issues.push({ path, message, ...(itemId ? { itemId } : {}) });

  if (!isObject(input)) {
    return [{ path: '(전체)', message: '결과 파일은 JSON 객체여야 합니다.' }];
  }
  const { rubric, uploadedFiles, participantNames } = ctx;

  // 1. 형식과 기준표 버전
  if (input.format !== RESULT_FORMAT) add('format', `format은 "${RESULT_FORMAT}"이어야 합니다.`);
  if (input.rubric !== rubricRef(rubric)) {
    add('rubric', `이 모듈의 채점 기준표는 "${rubricRef(rubric)}"인데 결과 파일에는 "${String(input.rubric)}"로 적혀 있습니다.`);
  }

  // 7. 참가자
  if (!isNonEmptyString(input.participant)) {
    add('participant', '참가자 이름이 필요합니다.');
  } else if (participantNames && !participantNames.includes(input.participant.trim())) {
    add('participant', `"${input.participant}"은(는) 이 대회에 등록된 참가자가 아닙니다.`);
  }
  if (input.target !== undefined && typeof input.target !== 'string') add('target', 'target은 문자열이어야 합니다.');

  const fileExists = (name: string) => !uploadedFiles || uploadedFiles.has(name);
  const checkFile = (path: string, name: unknown, itemId?: string) => {
    if (!isNonEmptyString(name)) {
      add(path, '파일 이름이 비어 있습니다.', itemId);
    } else if (!fileExists(name)) {
      const lower = [...(uploadedFiles ?? [])].find((f) => f.toLowerCase() === name.toLowerCase());
      add(
        path,
        lower
          ? `올라온 파일은 "${lower}"인데 "${name}"로 적혀 있습니다. 대소문자까지 같아야 합니다.`
          : `"${name}" 파일이 올라오지 않았습니다.`,
        itemId,
      );
    }
  };

  // 2~6. 항목
  const byId = new Map<string, RubricItem>(rubric.items.map((it) => [it.id, it]));
  const seen = new Set<string>();
  if (!Array.isArray(input.items)) {
    add('items', 'items는 배열이어야 합니다.');
  } else {
    input.items.forEach((raw, i) => {
      const at = `items[${i}]`;
      if (!isObject(raw)) {
        add(at, '항목은 객체여야 합니다.');
        return;
      }
      const id = raw.id;
      if (!isNonEmptyString(id)) {
        add(at, '항목 id가 필요합니다.');
        return;
      }
      const where = `${at} (${id})`;
      const item = byId.get(id);
      if (!item) {
        add(where, `기준표에 없는 항목 id입니다.`, id);
        return;
      }
      if (seen.has(id)) {
        add(where, '같은 항목이 두 번 나왔습니다.', id);
        return;
      }
      seen.add(id);

      const score = raw.score;
      if (typeof score !== 'number' || !Number.isFinite(score)) {
        add(where, '점수(score)는 숫자여야 합니다.', id);
        return;
      }
      if (score < -EPS || score > item.points + EPS) {
        add(where, `점수 ${score}는 0 이상 ${item.points} 이하여야 합니다.`, id);
      }
      if (item.type === 'subjective' && item.step) {
        const ratio = score / item.step;
        if (Math.abs(ratio - Math.round(ratio)) > 1e-6) {
          add(where, `점수 ${score}는 ${item.step} 단위여야 합니다.`, id);
        }
      }
      const aon = isAllOrNothing(item);
      if (aon && Math.abs(score) > EPS && Math.abs(score - item.points) > EPS) {
        add(where, `전부/전무 항목이라 0점 또는 ${item.points}점만 가능합니다.`, id);
      }

      // failed
      if (raw.failed !== undefined) {
        if (!isStringArray(raw.failed)) {
          add(where, 'failed는 확인 사항 id의 배열이어야 합니다.', id);
        } else {
          const valid = new Set((item.checks ?? []).map((c) => c.id));
          for (const f of raw.failed) {
            if (!valid.has(f)) add(where, `failed의 "${f}"는 이 항목의 확인 사항 id가 아닙니다.`, id);
          }
          if (raw.failed.length > 0 && aon && score > EPS) {
            add(where, `확인 사항이 실패했는데 전부/전무 항목이 ${score}점입니다. 0점이어야 합니다.`, id);
          }
        }
      }
      if (aon && item.checks?.length && score > EPS && Math.abs(score - item.points) <= EPS) {
        const failedLen = Array.isArray(raw.failed) ? raw.failed.length : 0;
        if (failedLen > 0) add(where, '만점인 전부/전무 항목은 failed가 비어 있어야 합니다.', id);
      }

      // 5. 코멘트
      const deducted = score < item.points - EPS;
      if (deducted) {
        const c = raw.comment;
        if (!isObject(c)) {
          add(where, '점수가 깎인 항목에는 comment(issue, evidence, fix)가 필요합니다.', id);
        } else {
          if (!isNonEmptyString(c.issue)) add(`${where}.comment.issue`, '무엇이 잘못됐는지 한 문장이 필요합니다.', id);
          else if (c.issue.length > COMMENT_MAX_LENGTH) {
            add(`${where}.comment.issue`, `issue는 ${COMMENT_MAX_LENGTH}자 이내여야 합니다(지금 ${c.issue.length}자).`, id);
          }
          if (!isNonEmptyString(c.fix)) add(`${where}.comment.fix`, '고칠 방법 한 문장이 필요합니다.', id);
          else if (c.fix.length > COMMENT_MAX_LENGTH) {
            add(`${where}.comment.fix`, `fix는 ${COMMENT_MAX_LENGTH}자 이내여야 합니다(지금 ${c.fix.length}자).`, id);
          }
          if (!isStringArray(c.evidence) || c.evidence.length === 0) {
            add(`${where}.comment.evidence`, '근거 캡처 파일이 1개 이상 필요합니다. 추측으로 깎은 점수는 허용하지 않습니다.', id);
          } else {
            c.evidence.forEach((f, k) => checkFile(`${where}.comment.evidence[${k}]`, f, id));
          }
        }
      } else if (isObject(raw.comment) && isStringArray((raw.comment as Record<string, unknown>).evidence)) {
        // 만점 항목의 코멘트는 생략할 수 있지만, 적었다면 파일은 있어야 한다.
        ((raw.comment as Record<string, unknown>).evidence as string[]).forEach((f, k) =>
          checkFile(`${where}.comment.evidence[${k}]`, f, id),
        );
      }
    });
  }
  for (const it of rubric.items) {
    if (Array.isArray(input.items) && !seen.has(it.id)) {
      add('items', `채점 항목 ${it.id} (${it.title})가 빠졌습니다.`, it.id);
    }
  }

  // notes
  if (input.notes !== undefined) {
    if (!Array.isArray(input.notes)) add('notes', 'notes는 배열이어야 합니다.');
    else {
      input.notes.forEach((n, i) => {
        const at = `notes[${i}]`;
        if (!isObject(n)) return add(at, '노트는 객체여야 합니다.');
        if (n.kind !== 'proto' && n.kind !== 'code' && n.kind !== 'etc') {
          add(at, 'kind는 proto, code, etc 중 하나여야 합니다.');
        }
        if (!isNonEmptyString(n.title)) add(at, '노트 제목이 필요합니다.');
        if (typeof n.body !== 'string') add(at, '노트 본문(body)이 필요합니다.');
        if (n.images !== undefined) {
          if (!isStringArray(n.images)) add(at, 'images는 파일 이름 배열이어야 합니다.');
          else n.images.forEach((f, k) => checkFile(`${at}.images[${k}]`, f));
        }
      });
    }
  }
  // screenshots
  if (input.screenshots !== undefined) {
    if (!Array.isArray(input.screenshots)) add('screenshots', 'screenshots는 배열이어야 합니다.');
    else {
      input.screenshots.forEach((s, i) => {
        const at = `screenshots[${i}]`;
        if (!isObject(s)) return add(at, '캡처 항목은 객체여야 합니다.');
        checkFile(`${at}.file`, s.file);
        if (s.caption !== undefined && typeof s.caption !== 'string') add(at, 'caption은 문자열이어야 합니다.');
      });
    }
  }
  return issues;
}

/** 검사를 통과한 결과의 점수를 계산한다. 합계는 저장하지 않고 항상 항목에서 계산한다. */
export function computeScores(rubric: Rubric, result: Pick<GradingResult, 'items'>): Scores {
  const byId = new Map(result.items.map((r) => [r.id, r.score]));
  let sub = 0;
  let obj = 0;
  for (const it of rubric.items) {
    const s = byId.get(it.id) ?? 0;
    if (it.type === 'subjective') sub += s;
    else obj += s;
  }
  const maxTotal = rubric.max.subjective + rubric.max.objective;
  const total = round(sub + obj);
  return {
    subjective: round(sub),
    objective: round(obj),
    total,
    maxSubjective: rubric.max.subjective,
    maxObjective: rubric.max.objective,
    maxTotal,
    deduction: round(maxTotal - total),
  };
}

/** 검사 결과를 화면용 문장으로 만든다. */
export function formatIssue(issue: ValidationIssue): string {
  return `${issue.path}: ${issue.message}`;
}

/** 결과 파일에서 참조하는 모든 캡처 파일 이름을 모은다(중복 없이). */
export function referencedFiles(result: GradingResult): string[] {
  const out = new Set<string>();
  for (const it of result.items) for (const f of it.comment?.evidence ?? []) out.add(f);
  for (const n of result.notes ?? []) for (const f of n.images ?? []) out.add(f);
  for (const s of result.screenshots ?? []) out.add(s.file);
  return [...out];
}
