import test from 'node:test';
import assert from 'node:assert/strict';
import { parseListQuery, containsI, digits, PAGE_SIZES, DEFAULT_PAGE_SIZE } from './listPagination.js';

test('parseListQuery: opt-in — no page → legacy full-array mode', () => {
  const r = parseListQuery({});
  assert.equal(r.paginated, false);
});

test('parseListQuery: page present → paginated with clamped size + skip', () => {
  const r = parseListQuery({ page: '3', pageSize: '100', search: '  דוד  ' });
  assert.equal(r.paginated, true);
  assert.equal(r.page, 3);
  assert.equal(r.pageSize, 100);
  assert.equal(r.skip, 200);
  assert.equal(r.take, 100);
  assert.equal(r.search, 'דוד');
});

test('parseListQuery: page/size floors and ceilings', () => {
  assert.equal(parseListQuery({ page: '0' }).page, 1);
  assert.equal(parseListQuery({ page: '-5' }).page, 1);
  assert.equal(parseListQuery({ page: '1', pageSize: '9999' }).pageSize, 200, 'clamped to max 200');
  assert.equal(parseListQuery({ page: '1', pageSize: '0' }).pageSize, DEFAULT_PAGE_SIZE, 'invalid 0 → default');
  assert.equal(parseListQuery({ page: '1', pageSize: '13' }).pageSize, 13, 'a valid custom size passes through');
  assert.equal(parseListQuery({ page: '1' }).pageSize, DEFAULT_PAGE_SIZE);
});

test('parseListQuery: accepts q as a search alias', () => {
  assert.equal(parseListQuery({ page: '1', q: 'abc' }).search, 'abc');
});

test('helpers: containsI (insensitive) + digits', () => {
  assert.deepEqual(containsI('x'), { contains: 'x', mode: 'insensitive' });
  assert.equal(digits('054-812 3456'), '0548123456');
  assert.equal(digits(null), '');
});

test('the offered page sizes are the approved set', () => {
  assert.deepEqual(PAGE_SIZES, [20, 50, 100, 200]);
});
