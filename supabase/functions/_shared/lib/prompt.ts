import { COMMENT_MAX_LENGTH, RESULT_FORMAT, type Rubric } from './types.ts';
import { isAllOrNothing, rubricRef } from './validate.ts';

export interface PromptContext {
  contestName: string;
  moduleCode: string;
  moduleTitle?: string;
  moduleFolder: string;
  rubric: Rubric;
  /** 이 대회에 등록된 참가자 이름과 저장소 이름(채점 대상) */
  participants?: { name: string; repo?: string }[];
  /** 제출물 내려받기 안내 문구(조직, 폴더 규칙 등). 없으면 기본 문구 */
  downloadNote?: string;
}

function itemBlock(rubric: Rubric): string {
  return rubric.items
    .map((it) => {
      const kind = it.type === 'subjective' ? '주관' : '객관';
      const lines = [`- ${it.id} [${kind}] ${it.title} (${it.points}점)`];
      if (it.type === 'subjective') {
        lines.push(`  - 점수는 0 이상 ${it.points} 이하${it.step ? `, ${it.step} 단위` : ''}`);
      } else if (isAllOrNothing(it)) {
        lines.push(`  - 전부/전무: 0점 또는 ${it.points}점만 가능`);
      }
      if (it.guide) lines.push(`  - 채점 요령: ${it.guide}`);
      for (const c of it.checks ?? []) lines.push(`  - 확인 ${c.id}: ${c.text}`);
      return lines.join('\n');
    })
    .join('\n');
}

/** 관리자가 AI에게 붙여 넣을 채점 지시문을 만든다. */
export function buildInstructionPrompt(ctx: PromptContext): string {
  const { rubric } = ctx;
  const exampleItem = rubric.items.find((i) => i.type === 'objective' && i.checks?.length) ?? rubric.items[0];
  const people = ctx.participants?.length
    ? `\n## 채점할 참가자\n${ctx.participants.map((p) => `- ${p.name}${p.repo ? ` (${p.repo})` : ''}`).join('\n')}\n`
    : '';

  return `# 채점 지시문: ${ctx.contestName} · Module ${ctx.moduleCode}${ctx.moduleTitle ? ` (${ctx.moduleTitle})` : ''}

당신은 기능경기대회 모바일앱개발 채점 보조입니다. 참가자 한 명당 결과 파일 \`result.json\` 하나와 캡처 폴더를 만드세요.
점수의 총점, 주관 합계, 객관 합계, 감점은 쓰지 않습니다. 사이트가 항목 점수에서 계산합니다.
${people}
## 작업 순서
1. 제출물 내려받기: ${ctx.downloadNote ?? `관리자 화면의 "모두 받기"로 받은 zip을 풉니다. 파일 이름에 채점할 커밋 번호가 들어 있습니다. 소스는 \`${ctx.moduleFolder}/\` 폴더에 있습니다.`}
2. 빌드: Flutter 프로젝트를 \`flutter pub get\` 후 빌드해서 실행합니다. 빌드가 안 되면 그 사실과 오류를 \`notes\`(kind: "etc")에 적고, 실행 확인이 필요한 항목은 0점으로 채점합니다.
3. 캡처: 앱을 실제로 실행하면서 화면을 캡처합니다. 점수를 깎는 모든 근거는 캡처 파일로 남깁니다. 파일 이름은 \`번호_내용.png\` 형식(예: \`06_name_error_empty.png\`)으로 하고, 대소문자까지 \`result.json\`에 적은 이름과 같아야 합니다.
4. 채점: 아래 채점 기준표의 항목을 하나도 빠짐없이, 한 번씩만 채점합니다.
5. 결과 파일 작성: 아래 형식으로 \`result.json\`을 만듭니다. 캡처는 같은 폴더(또는 하위 폴더)에 둡니다.

## 채점 기준표: ${rubric.title} (${rubricRef(rubric)})
만점: 주관 ${rubric.max.subjective}점 + 객관 ${rubric.max.objective}점 = ${rubric.max.subjective + rubric.max.objective}점

${itemBlock(rubric)}

## 결과 파일 형식
\`\`\`json
{
  "format": "${RESULT_FORMAT}",
  "rubric": "${rubricRef(rubric)}",
  "participant": "참가자 이름(등록된 이름 그대로)",
  "target": "채점한 저장소 이름 또는 zip 이름",
  "items": [
    { "id": "${exampleItem?.id ?? 'S1'}", "score": 0,${exampleItem?.checks?.length ? ` "failed": ["${exampleItem.checks[0]?.id}"],` : ''}
      "comment": { "issue": "무엇이 잘못됐는지 한 문장", "evidence": ["06_example.png"], "fix": "고칠 방법 한 문장" } },
    { "id": "만점 항목 id", "score": 2 }
  ],
  "notes": [
    { "kind": "proto", "title": "프로토타입 대조", "body": "마크다운 본문", "images": ["prototype/screen.png", "03_screen.png"] },
    { "kind": "code", "title": "코드 리뷰 제목", "body": "마크다운 본문" }
  ],
  "screenshots": [
    { "file": "05_name_screen.png", "caption": "이름 화면" }
  ]
}
\`\`\`

## 규칙
- \`items\`에는 위 채점 기준표의 모든 항목이 한 번씩 있어야 합니다. 없는 id, 빠진 id, 겹친 id는 업로드할 때 막힙니다.
- 점수는 0 이상 배점 이하입니다. 주관 항목은 항목에 적힌 단위를 지키고, 전부/전무 항목은 0 또는 만점만 줍니다.
- \`failed\`는 그 항목의 확인 사항 id만 적습니다. 전부/전무 항목은 \`failed\`가 하나라도 있으면 0점, 비어 있을 때만 만점입니다.
- 점수가 깎인 항목에는 \`comment\`가 반드시 있어야 합니다. 만점 항목은 생략해도 됩니다.
  - \`issue\`: 무엇이 잘못됐는지 한 문장, ${COMMENT_MAX_LENGTH}자 이내
  - \`fix\`: 고칠 방법 한 문장, ${COMMENT_MAX_LENGTH}자 이내
  - \`evidence\`: 캡처 파일 이름 1개 이상. 직접 확인하지 못한 것을 추측으로 깎지 않습니다.
- \`notes\`는 프로토타입 대조(\`proto\`), 코드 리뷰(\`code\`), 기타(\`etc\`) 세 종류이며 점수에 영향을 주지 않습니다. 본문은 마크다운이고 HTML은 쓰지 않습니다.
- \`evidence\`, \`images\`, \`screenshots\`에 적은 파일은 실제로 함께 올려야 합니다.
- 참가자가 제출하지 않았거나 빌드가 불가능하면 해당 항목을 0점으로 채점하고 이유를 \`comment\`와 \`notes\`에 적습니다.
- 응답은 \`result.json\` 내용(JSON 하나)만 내고, 설명 문장을 JSON 밖에 섞지 않습니다.
`;
}
