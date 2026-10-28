// Persora Forms — Standalone DB, RLS, R2 image-only validation (no video),
// Quiz mode scoring, Event registration capacity limits, CSV export, and privacy tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVaultDatabase } from './password-vault-db.mjs';
import { handleForms, handlePublicForms, exportFormsData } from '../cloudflare/forms.js';
import worker from '../cloudflare/api.js';

const ORIGIN = 'https://persora.example';
const env = { SUPABASE_URL: 'https://db.example.test', SUPABASE_SECRET_KEY: 'test-service-key' };
const ctx = await createVaultDatabase();
const { db } = ctx;

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (!url.pathname.startsWith('/rest/v1/rpc/')) return Response.json([]);
  const name = url.pathname.split('/').pop();
  const args = init.body ? JSON.parse(init.body) : {};
  try {
    const result = await ctx.rpc(name, args);
    return Response.json(result ?? null);
  } catch (error) {
    return Response.json({ code: error.code, message: error.message }, { status: 400 });
  }
};

function memoryBucket() {
  const objects = new Map();
  return {
    objects,
    async put(key, body, options = {}) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      objects.set(key, {
        bytes,
        httpMetadata: options.httpMetadata || {},
        customMetadata: options.customMetadata || {},
      });
    },
    async get(key) {
      const entry = objects.get(key);
      return entry
        ? {
            body: new Blob([entry.bytes]).stream(),
            size: entry.bytes.byteLength,
            httpMetadata: entry.httpMetadata,
            customMetadata: entry.customMetadata,
          }
        : null;
    },
    async head(key) {
      const entry = objects.get(key);
      return entry ? { size: entry.bytes.byteLength, customMetadata: entry.customMetadata } : null;
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}

// Valid minimal 1x1 PNG bytes
const VALID_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
]);

// Fake MP4 header bytes ("....ftypisom")
const FAKE_MP4_BYTES = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
]);

const alice = { id: (await ctx.addMember('forms-alice')).id };
const bob = { id: (await ctx.addMember('forms-bob')).id };

async function callOwner(method, path, body, who = alice, extraEnv = {}, services = {}) {
  const init = { method };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const res = await handleForms(new Request(`${ORIGIN}/api${path}`, init), who, { ...env, ...extraEnv }, ORIGIN, services);
  const ct = res.headers.get('content-type') || '';
  return {
    status: res.status,
    headers: res.headers,
    body: ct.includes('json') ? await res.json() : ct.includes('csv') ? await res.text() : new Uint8Array(await res.arrayBuffer()),
  };
}

async function callPublic(method, path, body, signedInWho = null, extraEnv = {}, services = {}) {
  const init = { method };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const res = await handlePublicForms(new Request(`${ORIGIN}/api${path}`, init), { ...env, ...extraEnv }, ORIGIN, signedInWho, services);
  const ct = res.headers.get('content-type') || '';
  return {
    status: res.status,
    headers: res.headers,
    body: ct.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer()),
  };
}

test('standalone boundary & RLS: Persora Forms tables enforce owner RLS and have zero coupling to Persora Table', async () => {
  const tables = await db.query(
    `select relname, relrowsecurity from pg_class
     where relnamespace = 'public'::regnamespace
       and relname in ('persora_forms', 'persora_form_responses', 'persora_form_assets')
     order by relname`,
  );
  assert.equal(tables.rows.length, 3);
  for (const r of tables.rows) assert.equal(r.relrowsecurity, true, `${r.relname} has RLS enabled`);

  // Verify zero foreign keys linking persora_form* to persora_table*
  const crossFk = await db.query(
    `select conname from pg_constraint c
     join pg_class src on src.oid = c.conrelid
     join pg_class dst on dst.oid = c.confrelid
     where (src.relname like 'persora_form%' and dst.relname like 'persora_table%')
        or (src.relname like 'persora_table%' and dst.relname like 'persora_form%')`,
  );
  assert.equal(crossFk.rows.length, 0, 'Persora Forms must remain completely standalone from Persora Table');

  // Anonymous worker check on /api/forms
  const unauth = await worker.fetch(new Request(`${ORIGIN}/api/forms`, { method: 'GET' }), env, { waitUntil() {} });
  assert.equal(unauth.status, 401);
});

test('all question types, R2 image-only validation (blocking video), publishing, Quiz scoring, CSV export, and respondent privacy', async () => {
  const bucket = memoryBucket();
  const r2Env = { VAULT_FILES: bucket };

  // 1. Create form with all 8 core question types + respondent image_upload
  const createRes = await callOwner('POST', '/forms', {
    title: 'Engineering Onboarding & Quiz',
    description: 'Standalone assessment and onboarding form',
    settings: {
      defaultRequired: true,
      requireSignIn: false,
      confirmationMessage: 'Welcome aboard! Your submission is saved.',
      closedMessage: 'Onboarding window has closed.',
      quiz: { enabled: true, showScoreImmediately: true, showCorrectAnswers: true },
      eventRegistration: { enabled: false, maxRegistrations: null, eventDate: '', eventLocation: '' },
    },
    questions: [
      { id: 'q_short', type: 'short_text', title: 'Preferred programming language', required: true, quiz: { points: 2, acceptedAnswers: ['TypeScript', 'Rust'], correctOptionIds: [], explanation: 'We use TypeScript and Rust.' } },
      { id: 'q_long', type: 'long_text', title: 'Briefly describe a project you built', required: true },
      { id: 'q_mc', type: 'multiple_choice', title: 'Which SQL clause filters grouped rows?', required: true, options: [{ id: 'mc_where', label: 'WHERE' }, { id: 'mc_having', label: 'HAVING' }], quiz: { points: 5, correctOptionIds: ['mc_having'], acceptedAnswers: [], explanation: 'HAVING filters groups after GROUP BY.' } },
      { id: 'q_cb', type: 'checkboxes', title: 'Select valid HTTP idempotent methods', required: true, options: [{ id: 'cb_get', label: 'GET' }, { id: 'cb_put', label: 'PUT' }, { id: 'cb_post', label: 'POST' }], quiz: { points: 3, correctOptionIds: ['cb_get', 'cb_put'], acceptedAnswers: [], explanation: 'GET and PUT are idempotent.' } },
      { id: 'q_dd', type: 'dropdown', title: 'Preferred T-shirt size', required: true, options: [{ id: 'sz_m', label: 'Medium' }, { id: 'sz_l', label: 'Large' }] },
      { id: 'q_scale', type: 'linear_scale', title: 'Confidence with Postgres RLS', required: true, scaleMin: 1, scaleMax: 5, minLabel: 'Beginner', maxLabel: 'Expert' },
      { id: 'q_date', type: 'date', title: 'Start date', required: true },
      { id: 'q_time', type: 'time', title: 'Preferred standup time', required: true },
      { id: 'q_img', type: 'image_upload', title: 'Badge photo (image only)', required: true },
    ],
  }, alice, r2Env);
  assert.equal(createRes.status, 201);
  const form = createRes.body.form;
  const slug = form.publicSlug;

  // Draft form is NOT publicly accessible yet
  const draftPub = await callPublic('GET', `/public/forms/${slug}`, undefined, null, r2Env);
  assert.equal(draftPub.status, 404);

  // Builder image upload: reject video (.mp4 / video/mp4) & disguised MP4 bytes, accept valid PNG
  const videoFd = new FormData();
  videoFd.append('file', new File([FAKE_MP4_BYTES], 'demo.mp4', { type: 'video/mp4' }));
  const videoRes = await callOwner('POST', `/forms/${form.id}/assets`, videoFd, alice, r2Env);
  assert.equal(videoRes.status, 415);
  assert.match(videoRes.body.error, /video/i);

  const disguisedVideoFd = new FormData();
  disguisedVideoFd.append('file', new File([FAKE_MP4_BYTES], 'sneaky.png', { type: 'image/png' }));
  const disguisedRes = await callOwner('POST', `/forms/${form.id}/assets`, disguisedVideoFd, alice, r2Env);
  assert.equal(disguisedRes.status, 415);

  const validBannerFd = new FormData();
  validBannerFd.append('file', new File([VALID_PNG_BYTES], 'banner.png', { type: 'image/png' }));
  const bannerUpload = await callOwner('POST', `/forms/${form.id}/assets`, validBannerFd, alice, r2Env);
  assert.equal(bannerUpload.status, 201);
  const bannerAssetId = bannerUpload.body.asset.id;

  // Attach headerImage and publish form
  const publishedRes = await callOwner('PUT', `/forms/${form.id}`, {
    status: 'published',
    headerImage: { assetId: bannerAssetId, alt: 'Header' },
  }, alice, r2Env);
  assert.equal(publishedRes.status, 200);
  assert.equal(publishedRes.body.form.status, 'published');

  // Public GET returns sanitized questions WITHOUT leaking quiz answer keys!
  const pubMeta = await callPublic('GET', `/public/forms/${slug}`, undefined, null, r2Env);
  assert.equal(pubMeta.status, 200);
  const pubMc = pubMeta.body.form.questions.find((q) => q.id === 'q_mc');
  assert.equal(pubMc.quiz, undefined, 'correctOptionIds must never leak to public respondents');
  assert.equal(pubMc.points, 5);

  // Public banner image is readable via slug
  const pubBanner = await callPublic('GET', `/public/forms/${slug}/assets/${bannerAssetId}`, undefined, null, r2Env);
  assert.equal(pubBanner.status, 200);

  // Public respondent upload: video is blocked, valid PNG succeeds
  const respVideoFd = new FormData();
  respVideoFd.append('file', new File([FAKE_MP4_BYTES], 'clip.webm', { type: 'video/webm' }));
  const respVideoRes = await callPublic('POST', `/public/forms/${slug}/upload`, respVideoFd, null, r2Env);
  assert.equal(respVideoRes.status, 415);

  const respImgFd = new FormData();
  respImgFd.append('file', new File([VALID_PNG_BYTES], 'badge.png', { type: 'image/png' }));
  const respImgUpload = await callPublic('POST', `/public/forms/${slug}/upload`, respImgFd, null, r2Env);
  assert.equal(respImgUpload.status, 201);
  const respAsset = respImgUpload.body.asset;

  // Missing required field fails validation
  const incompleteSubmit = await callPublic('POST', `/public/forms/${slug}/submit`, {
    answers: { q_short: 'TypeScript' },
  }, null, r2Env);
  assert.equal(incompleteSubmit.status, 400);

  // Complete submission succeeds and computes Quiz score accurately
  const submitRes = await callPublic('POST', `/public/forms/${slug}/submit`, {
    answers: {
      q_short: 'typescript', // 2/2 pts (case-insensitive)
      q_long: 'Built a zero-knowledge vault sync engine.',
      q_mc: 'mc_having', // 5/5 pts
      q_cb: ['cb_get'], // 0/3 pts (partial mismatch)
      q_dd: 'sz_l',
      q_scale: 5,
      q_date: '2026-11-01',
      q_time: '09:30',
      q_img: { assetId: respAsset.id, name: respAsset.name, type: respAsset.type, size: respAsset.size },
    },
  }, null, r2Env);
  assert.equal(submitRes.status, 201);
  assert.equal(submitRes.body.confirmationMessage, 'Welcome aboard! Your submission is saved.');
  assert.equal(submitRes.body.quizResult.score, 7);
  assert.equal(submitRes.body.quizResult.maxScore, 10);
  assert.equal(submitRes.body.quizResult.percentage, 70);

  // Privacy checks:
  // 1) Public respondent image CANNOT be fetched via public /public/forms/:slug/assets/:id!
  const leakAttempt = await callPublic('GET', `/public/forms/${slug}/assets/${respAsset.id}`, undefined, null, r2Env);
  assert.equal(leakAttempt.status, 404, 'respondent uploaded image must stay private to form owner');

  // 2) Public route has NO endpoint to read submissions
  const pubRespAttempt = await callPublic('GET', `/public/forms/${slug}/responses`, undefined, null, r2Env);
  assert.equal(pubRespAttempt.status, 404);

  // 3) Another signed-in user (Bob) CANNOT read Alice's form or responses
  const bobStealAttempt = await callOwner('GET', `/forms/${form.id}/responses`, undefined, bob, r2Env);
  assert.equal(bobStealAttempt.status, 404);

  // 4) Owner (Alice) CAN read responses, fetch respondent image, and export CSV!
  const ownerResponses = await callOwner('GET', `/forms/${form.id}/responses`, undefined, alice, r2Env);
  assert.equal(ownerResponses.status, 200);
  assert.equal(ownerResponses.body.responseCount, 1);
  assert.equal(ownerResponses.body.responses[0].quizResult.score, 7);

  const ownerFetchRespImg = await callOwner('GET', `/forms/${form.id}/assets/${respAsset.id}`, undefined, alice, r2Env);
  assert.equal(ownerFetchRespImg.status, 200);

  const csvRes = await callOwner('GET', `/forms/${form.id}/responses?format=csv`, undefined, alice, r2Env);
  assert.equal(csvRes.status, 200);
  assert.match(csvRes.body, /Submitted At/);
  assert.match(csvRes.body, /HAVING/);
  assert.match(csvRes.body, /70%/);

  // Verify Persora Table count for Alice did NOT change (strict standalone boundary)
  const aliceTables = await db.query(`select count(*)::int as c from public.persora_tables where user_id = $1`, [alice.id]);
  assert.equal(aliceTables.rows[0].c, 0);
});

test('event registration capacity limits, stop accepting responses, requireSignIn, duplicate, and exportFormsData', async () => {
  const created = await callOwner('POST', '/forms', {
    title: 'Design System Summit',
    description: 'Limited-seat workshop',
    settings: {
      defaultRequired: true,
      requireSignIn: true,
      confirmationMessage: 'Seat confirmed!',
      closedMessage: 'Registration is now closed.',
      quiz: { enabled: false, showScoreImmediately: false, showCorrectAnswers: false },
      eventRegistration: {
        enabled: true,
        maxRegistrations: 2,
        eventDate: 'Nov 15, 2026',
        eventLocation: 'Dhaka',
      },
    },
    questions: [
      { id: 'q_role', type: 'short_text', title: 'Your role', required: true },
    ],
  }, alice);
  assert.equal(created.status, 201);
  const formId = created.body.form.id;
  const slug = created.body.form.publicSlug;

  await callOwner('PUT', `/forms/${formId}`, { status: 'published' }, alice);

  // Anonymous submission is rejected with 401 when requireSignIn is true
  const anonAttempt = await callPublic('POST', `/public/forms/${slug}/submit`, {
    respondentName: 'Guest One',
    respondentEmail: 'guest1@example.com',
    answers: { q_role: 'Designer' },
  }, null);
  assert.equal(anonAttempt.status, 401);

  // Signed-in registrations #1 and #2 succeed and issue REG-XXXXXX codes
  const reg1 = await callPublic('POST', `/public/forms/${slug}/submit`, {
    respondentName: 'Attendee One',
    respondentEmail: 'one@example.com',
    answers: { q_role: 'Designer' },
  }, bob);
  assert.equal(reg1.status, 201);
  assert.match(reg1.body.registrationCode, /^REG-[A-Z0-9]{6}$/);

  const reg2 = await callPublic('POST', `/public/forms/${slug}/submit`, {
    respondentName: 'Attendee Two',
    respondentEmail: 'two@example.com',
    answers: { q_role: 'Engineer' },
  }, alice);
  assert.equal(reg2.status, 201);

  // Registration #3 exceeds maxRegistrations=2 -> rejected with 409!
  const reg3 = await callPublic('POST', `/public/forms/${slug}/submit`, {
    respondentName: 'Attendee Three',
    respondentEmail: 'three@example.com',
    answers: { q_role: 'PM' },
  }, bob);
  assert.equal(reg3.status, 409);

  // Public GET now reports acceptingResponses=false, closedReason='capacity_full'
  const fullMeta = await callPublic('GET', `/public/forms/${slug}`, undefined, bob);
  assert.equal(fullMeta.status, 200);
  assert.equal(fullMeta.body.form.acceptingResponses, false);
  assert.equal(fullMeta.body.form.closedReason, 'capacity_full');

  // Duplicate form creates a fresh draft with 0 responses and new slug
  const dup = await callOwner('POST', `/forms/${formId}/duplicate`, { title: 'Summit Day 2' }, alice);
  assert.equal(dup.status, 201);
  assert.equal(dup.body.form.status, 'draft');
  assert.equal(dup.body.form.responseCount, 0);
  assert.notEqual(dup.body.form.publicSlug, slug);

  // Account export includes Alice's forms & responses and excludes Bob's
  const aliceExport = await exportFormsData(alice.id, env);
  assert.ok(aliceExport.forms.length >= 2);
  assert.ok(aliceExport.responses.length >= 2);
  const bobExport = await exportFormsData(bob.id, env);
  assert.equal(bobExport.forms.length, 0);
});

test('Google Forms themes: accentColor, backgroundStyle, and 5 presetHeader banners persist and flow to public /Form/:slug', async () => {
  const { FORM_PRESET_HEADER_IDS, FORM_THEME_COLORS, FORM_THEME_BACKGROUNDS } = await import('../cloudflare/forms-rules.js');
  assert.equal(FORM_PRESET_HEADER_IDS.length, 5, 'must provide 5 built-in preset header banners');
  assert.ok(FORM_THEME_COLORS.length >= 8);
  assert.equal(FORM_THEME_BACKGROUNDS.length, 4);

  const created = await callOwner('POST', '/forms', {
    title: 'Themed Design Survey',
    description: 'Testing Google Forms style themes',
    questions: [
      { id: 'q_theme_1', type: 'short_text', title: 'Favorite color?', description: '', required: true },
    ],
    settings: {
      defaultRequired: false,
      requireSignIn: false,
      confirmationMessage: 'Thanks!',
      closedMessage: 'Closed.',
      theme: {
        accentColor: 'teal',
        backgroundStyle: 'medium',
        presetHeader: 'botanical-calm',
      },
      quiz: { enabled: false, showScoreImmediately: true, showCorrectAnswers: false },
      eventRegistration: { enabled: false, maxRegistrations: null, eventDate: '', eventLocation: '' },
    },
  }, alice);
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.form.settings.theme, {
    accentColor: 'teal',
    backgroundStyle: 'medium',
    presetHeader: 'botanical-calm',
  });

  // Publish and verify public /public/forms/:slug receives theme metadata
  const published = await callOwner('PUT', `/forms/${created.body.form.id}`, {
    status: 'published',
    acceptingResponses: true,
    questions: created.body.form.questions,
    settings: created.body.form.settings,
  }, alice);
  assert.equal(published.status, 200);

  const pubRes = await callPublic('GET', `/public/forms/${created.body.form.publicSlug}`);
  assert.equal(pubRes.status, 200);
  assert.deepEqual(pubRes.body.form.theme, {
    accentColor: 'teal',
    backgroundStyle: 'medium',
    presetHeader: 'botanical-calm',
  });
});

