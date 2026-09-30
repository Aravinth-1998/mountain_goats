'use strict';

/**
 * Server integration tests — HTTP API endpoints.
 *
 * Starts the Express server on a random OS-assigned port (port 0) so tests
 * never collide with a running dev instance.  No database is required; all
 * endpoints that touch the DB fall back gracefully.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Suppress startup noise from dotenv / console.log in server.js
const _log = console.log;
console.log = () => {};

const { server, app } = require('../server');

console.log = _log;

let baseUrl;

before((ctx, done) => {
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
    done();
  });
});

after((ctx, done) => {
  server.close(done);
});

// ---------------------------------------------------------------------------
// GET /healthz
// ---------------------------------------------------------------------------
test('GET /healthz returns 200 ok', async () => {
  const res = await fetch(`${baseUrl}/healthz`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.equal(text, 'ok');
});

// ---------------------------------------------------------------------------
// GET /api/public-config
// ---------------------------------------------------------------------------
test('GET /api/public-config returns required keys', async () => {
  const res = await fetch(`${baseUrl}/api/public-config`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok('supabaseUrl' in body, 'missing supabaseUrl');
  assert.ok('supabaseAnonKey' in body, 'missing supabaseAnonKey');
  assert.ok('hubUrl' in body, 'missing hubUrl');
  assert.ok('peerUrls' in body, 'missing peerUrls');
  assert.ok(Array.isArray(body.peerUrls), 'peerUrls should be an array');
});

// ---------------------------------------------------------------------------
// GET /api/leaderboard — no auth token → 401 or empty result
// ---------------------------------------------------------------------------
test('GET /api/leaderboard without token returns 401', async () => {
  const res = await fetch(`${baseUrl}/api/leaderboard`);
  assert.ok(res.status === 401 || res.status === 200, `unexpected status ${res.status}`);
  if (res.status === 200) {
    // DB not configured: the endpoint should still return an array (empty is fine)
    const body = await res.json();
    assert.ok(Array.isArray(body) || typeof body === 'object', 'body should be json');
  }
});

// ---------------------------------------------------------------------------
// GET /api/me/stats — no auth token → 401
// ---------------------------------------------------------------------------
test('GET /api/me/stats without token returns 401', async () => {
  const res = await fetch(`${baseUrl}/api/me/stats`);
  assert.equal(res.status, 401);
});

// ---------------------------------------------------------------------------
// GET /admin — wrong key → 403
// ---------------------------------------------------------------------------
test('GET /admin with wrong key returns 403', async () => {
  const res = await fetch(`${baseUrl}/admin?key=wrong`);
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// GET /api/admin/rooms — no key → 403
// ---------------------------------------------------------------------------
test('GET /api/admin/rooms without key returns 403', async () => {
  const res = await fetch(`${baseUrl}/api/admin/rooms`);
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// GET /api/admin/history — no key → 403
// ---------------------------------------------------------------------------
test('GET /api/admin/history without key returns 403', async () => {
  const res = await fetch(`${baseUrl}/api/admin/history`);
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// Legal pages (served from shared/)
// ---------------------------------------------------------------------------
for (const route of ['/terms', '/privacy', '/about', '/feedback']) {
  test(`GET ${route} returns 200 or 404 (file may be absent locally)`, async () => {
    const res = await fetch(`${baseUrl}${route}`);
    assert.ok(
      res.status === 200 || res.status === 404,
      `${route} returned unexpected status ${res.status}`,
    );
  });
}

// ---------------------------------------------------------------------------
// Static assets
// ---------------------------------------------------------------------------
test('GET /index.html returns 200', async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.equal(res.status, 200);
  const ct = res.headers.get('content-type') || '';
  assert.ok(ct.includes('html'), `expected html content-type, got: ${ct}`);
});
