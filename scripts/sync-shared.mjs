// shared/*.ts 를 Edge Function이 가져다 쓸 수 있게 supabase/functions/_shared/ 로 복사한다.
// 검사 함수를 한 곳에서만 고치고, `npm run sync` 후 함께 커밋한다. `npm test`가 두 복사본이 같은지 확인한다.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'supabase/functions/_shared/lib');
mkdirSync(dest, { recursive: true });
for (const f of readdirSync(join(root, 'shared')).filter((f) => f.endsWith('.ts'))) {
  copyFileSync(join(root, 'shared', f), join(dest, f));
  console.log('copied', f);
}
