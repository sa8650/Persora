/* One-off visual snapshot harness: renders ProjectsView states and dumps static HTML. */
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { GlobalWindow } from 'happy-dom';

const happyWindow = new GlobalWindow({ url: 'http://localhost:5173/' });
for (const key of Object.getOwnPropertyNames(happyWindow)) {
  if (!(key in globalThis)) globalThis[key] = happyWindow[key];
}
globalThis.window = happyWindow;
globalThis.document = happyWindow.document;
globalThis.localStorage = happyWindow.localStorage;
globalThis.navigator = happyWindow.navigator;
globalThis.HTMLElement = happyWindow.HTMLElement;
globalThis.Element = happyWindow.Element;
globalThis.Node = happyWindow.Node;
globalThis.SVGElement = happyWindow.SVGElement;
globalThis.MutationObserver = happyWindow.MutationObserver;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const OWNER_ID = 'user-owner';
const MEMBER_ID = 'user-member';
const NOW = '2026-10-22T08:00:00.000Z';
const fixtures = {};
fixtures['GET /api/projects'] = {
  projects: [
    { id: 'proj-1', owner_id: OWNER_ID, name: 'Website relaunch', description: 'Ship the new marketing site with updated copy, art, and analytics.', kind: 'shared', created_at: NOW, updated_at: NOW, access: { owner: true, role: 'owner', canCreateFields: true }, stats: { fields: 5, completed: 2, inReview: 1, members: 4, pendingRequests: 2 } },
    { id: 'proj-2', owner_id: OWNER_ID, name: 'Tax season 2026', description: '', kind: 'personal', created_at: NOW, updated_at: NOW, access: { owner: true, role: 'owner', canCreateFields: true }, stats: { fields: 3, completed: 3, inReview: 0, members: 1, pendingRequests: 0 } },
  ],
};
const mkField = (o) => ({
  id: o.id, project_id: 'proj-1', folder_id: null, description: '', status: 'planning', progress: 0,
  creator_id: OWNER_ID, creator_name: 'Amina Rahman', assignee_id: null, due_date: null,
  created_at: NOW, updated_at: NOW, assigneeName: null, mine: { pinned: false, favourite: false }, commentCount: 0, comments: [], ...o,
});
fixtures['GET /api/projects/proj-1'] = {
  project: { id: 'proj-1', owner_id: OWNER_ID, name: 'Website relaunch', description: 'Ship the new marketing site with updated copy, art, and analytics.', kind: 'shared', created_at: NOW, updated_at: NOW },
  access: { owner: true, role: 'owner', canCreateFields: true, canRequest: false },
  owner: { id: OWNER_ID, name: 'Amina Rahman', email: 'amina@example.com', loginId: '1000001' },
  members: [
    { userId: MEMBER_ID, role: 'editor', canCreateFields: true, invitedBy: OWNER_ID, createdAt: NOW, name: 'Kris Ray', email: 'kris@example.com', loginId: '1000002' },
    { userId: 'user-critic', role: 'commenter', canCreateFields: false, invitedBy: OWNER_ID, createdAt: NOW, name: 'Nabila Noor', email: 'nabila@example.com', loginId: '1000003' },
    { userId: 'user-shadow', role: 'viewer', canCreateFields: false, invitedBy: OWNER_ID, createdAt: NOW, name: 'Fahim Hossain', email: 'fahim@example.com', loginId: '1000004' },
  ],
  folders: [
    { id: 'fold-1', project_id: 'proj-1', name: 'Design', color: 'purple', created_by: OWNER_ID, created_at: NOW, updated_at: NOW, fieldCount: 2 },
    { id: 'fold-2', project_id: 'proj-1', name: 'Content', color: 'orange', created_by: MEMBER_ID, created_at: NOW, updated_at: NOW, fieldCount: 2 },
    { id: 'fold-3', project_id: 'proj-1', name: 'Launch', color: 'cyan', created_by: OWNER_ID, created_at: NOW, updated_at: NOW, fieldCount: 1 },
  ],
  fields: [
    mkField({ id: 'fld-1', folder_id: 'fold-1', title: 'Hero illustration refresh', description: 'Replace the hero with the new brand art direction; keep contrast AA across day themes.', status: 'in-progress', progress: 45, creator_id: MEMBER_ID, creator_name: 'Kris Ray', assignee_id: OWNER_ID, assigneeName: 'Amina Rahman', due_date: '2026-11-05', mine: { pinned: true, favourite: true }, commentCount: 2,
      comments: [
        { id: 'cmt-1', field_id: 'fld-1', author_id: MEMBER_ID, author_name: 'Kris Ray', body: 'First pass is in the shared drive — contrast fixed on the mobile crop.', created_at: '2026-10-21T18:12:00Z', updated_at: '2026-10-21T18:12:00Z' },
        { id: 'cmt-2', field_id: 'fld-1', author_id: OWNER_ID, author_name: 'Amina Rahman', body: 'Love the direction. Ship the dark variant after review.', created_at: NOW, updated_at: NOW },
      ] }),
    mkField({ id: 'fld-2', folder_id: 'fold-2', title: 'Landing copy deck', status: 'in-review', progress: 80, due_date: '2026-10-30', commentCount: 1 }),
    mkField({ id: 'fld-3', title: 'SEO metadata pass', folder_id: 'fold-2', status: 'blocked', progress: 30, due_date: '2026-10-18', creator_name: 'Nabila Noor', assigneeName: 'Nabila Noor' }),
    mkField({ id: 'fld-4', title: 'Analytics events', folder_id: 'fold-3', status: 'planning', progress: 0 }),
    mkField({ id: 'fld-5', title: 'Brand palette tokens', status: 'completed', progress: 100 }),
  ],
  requests: [
    { id: 'req-1', project_id: 'proj-1', requester_id: MEMBER_ID, requester_name: 'Kris Ray', note: 'Design needs a tracked spot for the favicon set.', payload: { title: 'Favicon + social card set' }, status: 'pending', resolution_note: '', field_id: null, created_at: NOW, resolved_at: null },
    { id: 'req-2', project_id: 'proj-1', requester_id: 'user-shadow', requester_name: 'Fahim Hossain', note: '', payload: { title: 'Uptime smoke checks' }, status: 'approved', resolution_note: 'Good call — added.', field_id: 'fld-4', created_at: NOW, resolved_at: NOW },
  ],
  activity: [
    { id: 'act-1', actor_id: OWNER_ID, actor_name: 'Amina Rahman', action: 'field_status_changed', target: 'Hero illustration refresh → in-progress', created_at: NOW },
    { id: 'act-2', actor_id: MEMBER_ID, actor_name: 'Kris Ray', action: 'field_created', target: 'Hero illustration refresh', created_at: '2026-10-22T07:32:00Z' },
    { id: 'act-3', actor_id: OWNER_ID, actor_name: 'Amina Rahman', action: 'member_added', target: 'Fahim Hossain', created_at: '2026-10-21T09:10:00Z' },
  ],
};
fixtures['GET /api/projects/proj-2'] = fixtures['GET /api/projects/proj-1'];

globalThis.fetch = async (url, init = {}) => {
  const key = `${init.method || 'GET'} ${String(url)}`;
  const body = fixtures[key];
  return new Response(JSON.stringify(body || { error: 'not found' }), { status: body ? 200 : 404, headers: { 'Content-Type': 'application/json' } });
};

const esbuild = await import('esbuild');
const outDir = mkdtempSync(path.join(process.cwd(), 'node_modules', '.pj-view-'));
const outfile = path.join(outDir, 'ProjectsView.mjs');
await esbuild.build({
  entryPoints: [new URL('/home/user/Persora/src/components/ProjectsView.tsx', import.meta.url).pathname],
  outfile, bundle: true, format: 'esm', platform: 'browser', loader: { '.css': 'empty' },
  external: ['react', 'react-dom', 'lucide-react'], jsx: 'automatic',
  define: { 'import.meta.env.PROD': 'true', 'import.meta.env.VITE_USE_PAGES_FUNCTIONS': '"true"' }, logLevel: 'silent',
});

const { default: ProjectsView } = await import(outfile);
const React = await import('react');
const { act } = await import('react-dom/test-utils');
const { createRoot } = await import('react-dom/client');

const css = readFileSync('/home/user/Persora/src/components/projects.css', 'utf8');
const wrap = (title, body, dark = false) => `<!doctype html><html lang="en"${dark ? ' class="dark"' : ''}><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title><style>
:root { --p-blue: #465cff; }
* { box-sizing: border-box; }
body { margin: 0; padding: 1.4rem 1.6rem; font-family: "Inter", "Segoe UI", system-ui, sans-serif; background: #f4f6fb; color: #0f172a; }
html.dark body { background: #0f172a; color: #e2e8f0; }
${css}
.pj-modal-backdrop { position: absolute; }
</style></head><body>${body}</body></html>`;

async function renderState(name, act2) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(React.createElement(ProjectsView, { user: { id: OWNER_ID, fullName: 'Amina Rahman', email: 'amina@example.com', loginId: '1000001', role: 'member' }, notify: () => undefined })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  if (act2) await act2(container);
  const html = wrap(name, container.innerHTML);
  writeFileSync(`/home/user/shots/${name}.html`, html);
  writeFileSync(`/home/user/shots/${name}-dark.html`, wrap(name, container.innerHTML, true));
  await act(async () => { root.unmount(); });
  container.remove();
  console.log('wrote', name);
}
const click = async (el) => act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 30)); });

await renderState('pj-list');
await renderState('pj-detail-overview', async (c) => { await click(c.querySelector('.pj-project-card')); });
await renderState('pj-detail-folders', async (c) => {
  await click(c.querySelector('.pj-project-card'));
  await click([...c.querySelectorAll('.pj-section-nav button')].find((b) => b.textContent === 'Folders'));
});
await renderState('pj-detail-fields', async (c) => {
  await click(c.querySelector('.pj-project-card'));
  await click([...c.querySelectorAll('.pj-section-nav button')].find((b) => b.textContent === 'Fields'));
});
await renderState('pj-field-modal', async (c) => {
  await click(c.querySelector('.pj-project-card'));
  await click([...c.querySelectorAll('.pj-section-nav button')].find((b) => b.textContent === 'Fields'));
  await click(c.querySelector('.pj-field-card'));
});
await renderState('pj-requests-modal', async (c) => {
  await click(c.querySelector('.pj-project-card'));
  await click([...c.querySelectorAll('.pj-topbar-actions .pj-ghost-button')].find((b) => b.textContent.includes('Requests')));
});
await renderState('pj-members-modal', async (c) => {
  await click(c.querySelector('.pj-project-card'));
  await click([...c.querySelectorAll('.pj-topbar-actions .pj-ghost-button')].find((b) => b.textContent.includes('Team')));
});
await renderState('pj-new-field-modal', async (c) => {
  await click(c.querySelector('.pj-project-card'));
  await click([...c.querySelectorAll('.pj-topbar-actions .pj-primary-button')].find((b) => b.textContent.includes('New field')));
});
await renderState('pj-new-project-modal', async (c) => {
  await click([...c.querySelectorAll('.pj-primary-button')].find((b) => b.textContent.includes('New project')));
});
console.log('done');
process.exit(0);
