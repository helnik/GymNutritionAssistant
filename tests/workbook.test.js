import test from 'node:test';
import assert from 'node:assert/strict';
import readExcelFile from 'read-excel-file/node';
import { normalizeWorkbook, selectPeriod } from '../src/data.js';

test('optional local workbook imports and produces consistent period summaries', { skip: !process.env.WORKBOOK_PATH }, async () => {
  const sheets = await readExcelFile(process.env.WORKBOOK_PATH);
  const data = normalizeWorkbook(
    sheets.find((sheet) => sheet.sheet === 'Daily').data,
    sheets.find((sheet) => sheet.sheet === 'Training').data,
  );
  assert.ok(data.daily.length > 0);
  const period = selectPeriod(data, data.start, data.end);
  assert.equal(period.daily.length, data.daily.length);
  assert.equal(period.training.length, data.training.length);
  assert.equal(period.weeks.reduce((sum, week) => sum + week.sessions, 0), data.training.length);
  assert.equal(
    period.weeks.reduce((sum, week) => sum + week.weightCount, 0),
    data.daily.filter((row) => row.weight !== null).length,
  );
  const weights = data.daily.map((row) => row.weight).filter((value) => value !== null);
  if (weights.length) {
    assert.ok(Math.abs(period.averageWeight - weights.reduce((sum, value) => sum + value, 0) / weights.length) < 1e-10);
  } else {
    assert.equal(period.averageWeight, null);
  }
});
