import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ccvizHome } from '../home.mjs';

test('home: CCVIZ_HOME 우선 → 예전 ~/.cc-session-viz 가 있으면 그것 → 새 기본 ~/.cc-agent-viz', () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'ccviz-home-'));
  try {
    assert.equal(ccvizHome({ CCVIZ_HOME: '/x/y' }, h), '/x/y');
    assert.equal(ccvizHome({}, h), path.join(h, '.cc-agent-viz'));
    fs.mkdirSync(path.join(h, '.cc-session-viz'));
    assert.equal(ccvizHome({}, h), path.join(h, '.cc-session-viz'));
    assert.equal(ccvizHome({ CCVIZ_HOME: '/x/y' }, h), '/x/y');
  } finally { fs.rmSync(h, { recursive: true, force: true }); }
});
