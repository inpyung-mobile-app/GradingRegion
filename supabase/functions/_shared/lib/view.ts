import type { GradingResult, ItemComment, NoteKind, ResultNote, ResultScreenshot, Rubric, Scores } from './types.ts';
import { computeScores } from './validate.ts';

/** 참가자 화면에 보내는 항목. 채점 요령(guide)은 넣지 않는다. */
export interface ViewItem {
  id: string;
  type: 'subjective' | 'objective';
  title: string;
  points: number;
  score: number;
  deducted: boolean;
  failedChecks: { id: string; text: string }[];
  comment?: ItemComment;
}

export interface ModuleView {
  scores: Scores;
  items: ViewItem[];
  notes: ResultNote[];
  screenshots: ResultScreenshot[];
}

export const NOTE_KIND_LABEL: Record<NoteKind, string> = {
  proto: '프로토타입 대조',
  code: '코드 리뷰',
  etc: '기타',
};

/** 저장된 결과 본문과 채점 기준표로 화면용 데이터를 만든다. 관리자 미리보기와 참가자 화면이 같은 함수를 쓴다. */
export function buildModuleView(rubric: Rubric, result: GradingResult): ModuleView {
  const scoreById = new Map(result.items.map((r) => [r.id, r]));
  const items: ViewItem[] = rubric.items.map((it) => {
    const r = scoreById.get(it.id);
    const score = r?.score ?? 0;
    const failedIds = new Set(r?.failed ?? []);
    return {
      id: it.id,
      type: it.type,
      title: it.title,
      points: it.points,
      score,
      deducted: score < it.points - 1e-6,
      failedChecks: (it.checks ?? []).filter((c) => failedIds.has(c.id)),
      ...(r?.comment ? { comment: r.comment } : {}),
    };
  });
  return {
    scores: computeScores(rubric, result),
    items,
    notes: result.notes ?? [],
    screenshots: result.screenshots ?? [],
  };
}
