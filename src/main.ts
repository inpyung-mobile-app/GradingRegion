import './style.css';
import { installLinkHandler, render, route, setNotFound } from './lib/router.ts';
import { boardPage } from './pages/board.ts';
import { lostPage } from './pages/lost.ts';
import { resultPage } from './pages/result.ts';
import { html } from './lib/html.ts';
import { publicShell } from './shell.ts';
import { loginPage } from './admin/login.ts';
import { contestsPage, contestSettingsPage } from './admin/contests.ts';
import { rubricsPage } from './admin/rubrics.ts';
import { studentsPage } from './admin/students.ts';
import { peoplePage } from './admin/people.ts';
import { requestsPage } from './admin/requests.ts';
import { teamPage } from './admin/team.ts';
import { resultsPage } from './admin/results.ts';

route('/', boardPage);
route('/c/:slug', boardPage);
route('/c/:slug/me', resultPage);
route('/c/:slug/lost', lostPage);
route('/admin', contestsPage);
route('/admin/login', loginPage);
route('/admin/students', studentsPage);
route('/admin/requests', (ctx) => requestsPage(ctx));
route('/admin/team', teamPage);
route('/admin/c/:id', contestSettingsPage);
route('/admin/c/:id/rubrics', rubricsPage);
route('/admin/c/:id/people', (ctx) => peoplePage(ctx));
route('/admin/c/:id/results', resultsPage);
setNotFound(({ root }) => {
  root.innerHTML = publicShell(null, 'none', html`<main class="wrap"><section class="panel panel-b"><h1 style="font-size:22px">페이지를 찾을 수 없습니다</h1><p><a href="/">순위표로 가기</a></p></section></main>`).value;
});

installLinkHandler();
void render();
