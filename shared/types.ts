// 프런트엔드와 Edge Function이 함께 쓰는 형식. 이 파일은 외부 모듈을 가져오지 않는다.

export type ItemType = 'subjective' | 'objective';

export interface RubricCheck {
  id: string;
  text: string;
}

export interface RubricItem {
  id: string;
  type: ItemType;
  title: string;
  points: number;
  /** 주관 항목에서 허용하는 점수 단위(예: 0.05). 없으면 자유 */
  step?: number;
  /** 참이면 0점 또는 만점만 허용. 객관 항목의 기본값은 true */
  allOrNothing?: boolean;
  checks?: RubricCheck[];
  /** AI와 관리자에게만 보이는 채점 요령 */
  guide?: string;
}

export interface Rubric {
  id: string;
  version: number;
  title: string;
  max: { subjective: number; objective: number };
  items: RubricItem[];
}

export interface ItemComment {
  issue: string;
  evidence: string[];
  fix: string;
}

export interface ResultItem {
  id: string;
  score: number;
  failed?: string[];
  comment?: ItemComment;
}

export type NoteKind = 'proto' | 'code' | 'etc';

export interface ResultNote {
  kind: NoteKind;
  title: string;
  body: string;
  images?: string[];
}

export interface ResultScreenshot {
  file: string;
  caption?: string;
}

export interface GradingResult {
  format: 'grading-result/1';
  /** "루브릭id@버전" */
  rubric: string;
  participant: string;
  /** 채점 대상(저장소 이름 또는 zip 이름). 참고용 */
  target?: string;
  items: ResultItem[];
  notes?: ResultNote[];
  screenshots?: ResultScreenshot[];
}

export const RESULT_FORMAT = 'grading-result/1' as const;
export const COMMENT_MAX_LENGTH = 120;

export interface ValidationIssue {
  /** 사람이 읽을 위치. 예: items[2] (O3) */
  path: string;
  message: string;
  /** 해당 항목 id가 있으면 화면에서 그 항목을 표시한다 */
  itemId?: string;
}

export interface Scores {
  subjective: number;
  objective: number;
  total: number;
  maxSubjective: number;
  maxObjective: number;
  maxTotal: number;
  /** 감점 = 만점 − 점수 */
  deduction: number;
}
