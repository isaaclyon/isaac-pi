import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureReadOnlySql, validateReadOnlySql } from '../src/sql.mjs';

test('validateReadOnlySql accepts select and with queries', () => {
  assert.equal(validateReadOnlySql('SELECT * FROM tool_executions').ok, true);
  assert.equal(validateReadOnlySql('WITH x AS (SELECT 1) SELECT * FROM x').ok, true);
});

test('validateReadOnlySql rejects multi-statement and write SQL', () => {
  assert.equal(validateReadOnlySql('SELECT 1; SELECT 2').ok, false);
  assert.equal(validateReadOnlySql('DELETE FROM tool_executions').ok, false);
  assert.throws(() => ensureReadOnlySql('PRAGMA journal_mode=WAL'));
});

test('validateReadOnlySql allows forbidden words inside string literals', () => {
  assert.equal(validateReadOnlySql("SELECT 'update' AS word").ok, true);
});

test('validateReadOnlySql allows semicolons inside string literals', () => {
  assert.equal(validateReadOnlySql("SELECT ';' AS semi").ok, true);
});
