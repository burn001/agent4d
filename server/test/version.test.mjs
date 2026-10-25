// 버전: package.json 이 근거 — 서버 VERSION·/healthz·CLI 가 같은 값
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readVersion } from '../version.mjs';
import { VERSION } from '../index.mjs';

test('버전 = package.json version (SemVer), 서버 VERSION 과 같음', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(readVersion(), pkg.version);
  assert.equal(VERSION, pkg.version);
  assert.equal(readVersion('/no/such/package.json'), '0.0.0');
  const cl = fs.readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
  assert.ok(cl.includes(`## [${pkg.version}]`), 'CHANGELOG 에 지금 버전 절');
});
