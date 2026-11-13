import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeWorkbook, parseBestSet, rolling, weekly, selectPeriod,
  relationship, pearson, shiftDate, dateKey,
} from '../src/data.js';

const dailyHeaders = ['Date', 'Cal', 'Kg', 'Carbs', 'Protein', 'Body Water %', 'Skeletal Muscle kg', 'Waist cm'];
const trainingHeaders = ['Date', 'Workout', 'Working sets', 'Load volume kg', 'Best weighted set', 'Failure sets', 'Duration min', 'Carbs g', 'Morning weight kg'];
const makeData = (daily = [], training = []) => normalizeWorkbook([dailyHeaders, ...daily], [trainingHeaders, ...training]);
const sourceDay = (date, overrides = {}) => ({ date, weight: 75, calories: 2500, carbs: 200, protein: 170, water: 68, muscle: 44, waist: null, ...overrides });
const session = (date, overrides = {}) => ({ date, workout: 'Chest', sets: 20, volume: 5000, failure: null, duration: 60, best: null, ...overrides });

test('import preserves missing values and genuine zero; ignores cached Training nutrition lookups', () => {
  const data = makeData(
    [[46255, 2500, 75, null, 170], [46256, null, null, 0]],
    [[46255, 'Chest', 20, 5000, 'Bench Press: 80x10', null, 60, 999, 999],
      [46256, 'Chest', 20, 5000, null, 0, 60]],
  );
  assert.equal(data.daily[0].date, '2026-08-21');
  assert.equal(data.daily[0].carbs, null);
  assert.equal(data.daily[1].carbs, 0);
  assert.equal(data.daily[1].weight, null);
  assert.equal(data.training[0].failure, null);
  assert.equal(data.training[1].failure, 0);
  assert.equal(data.training[0].carbs, undefined);
  assert.equal(data.training[0].weight, undefined);
  assert.equal(data.issues.length, 0);
});

test('import validates required sheets/headers and rejects ambiguous duplicate daily dates', () => {
  assert.throws(() => normalizeWorkbook([['Date', 'Kg']], [trainingHeaders]), /missing required columns: Cal/);
  assert.throws(() => makeData([[46255, 2500, 75], [46255, 2400, 74]]), /duplicate entries/);
  const data = makeData([[46255, 2500, 75], ['bad', 2400, 74]]);
  assert.equal(data.daily.length, 1);
  assert.match(data.issues[0], /invalid or missing date/);
});

test('empty optional columns and blank template rows do not create phantom observations', () => {
  const data = normalizeWorkbook(
    [['Date', 'Cal', 'Kg'], [46255, 2500, 75], [null, null, null]],
    [trainingHeaders],
  );
  assert.equal(data.daily.length, 1);
  assert.equal(data.issues.length, 0);
  assert.equal(data.daily[0].waist, null);
});

test('invalid measurements and impossible failure counts are excluded with explicit notices', () => {
  const data = makeData([[46255, 2500, 0, -5, 'not a number', 105]], [[46255, 'Chest', 20, 5000, null, 21]]);
  assert.equal(data.daily[0].weight, null);
  assert.equal(data.daily[0].carbs, null);
  assert.equal(data.daily[0].water, null);
  assert.equal(data.training[0].failure, null);
  assert.equal(data.issues.length, 5);
});

test('best-set parsing supports both workbook formats and avoids extrapolating high-rep estimates', () => {
  const colon = parseBestSet('Bench Press: 80x10');
  const spaced = parseBestSet('Bench Press 100×8');
  assert.equal(colon.exercise, 'Bench Press');
  assert.ok(Math.abs(colon.e1rm - 106.6666667) < 0.0001);
  assert.equal(spaced.exercise, 'Bench Press');
  assert.equal(spaced.reps, 8);
  assert.equal(parseBestSet('Bench Press 120×1').e1rm, 120);
  assert.equal(parseBestSet('Bench Press:80x15').e1rm, null);
  assert.equal(parseBestSet('unknown'), null);
  assert.equal(parseBestSet('Bench Press 80x0'), null);
});

test('rolling averages use seven calendar days, not the last seven rows', () => {
  const days = [
    sourceDay('2026-10-01', { weight: 10 }),
    sourceDay('2026-10-10', { weight: 70 }),
    sourceDay('2026-10-12', { weight: null }),
    sourceDay('2026-10-13', { weight: 72 }),
  ];
  assert.equal(rolling(days, '2026-10-13', 'weight'), 71);
  assert.equal(rolling(days, '2026-10-20', 'weight'), null);
});

test('weekly reports use Friday-Thursday and suppress partial or under-covered comparisons', () => {
  const days = Array.from({ length: 15 }, (_, index) => sourceDay(shiftDate('2026-10-16', index), { weight: index < 7 ? 75 : 76 }));
  const weeks = weekly(days, [], '2026-10-16', '2026-10-30');
  assert.equal(weeks[0].end, '2026-10-22');
  assert.equal(weeks[1].change, 1);
  assert.equal(weeks[2].partial, true);
  assert.equal(weeks[2].change, null);
  assert.equal(weekly(days.slice(3), [], '2026-10-16', '2026-10-29')[1].change, null);
  assert.equal(weekly(days, [], '2026-10-17', '2026-10-29')[1].change, null);
});

test('date selection is inclusive, comparison windows are equal length, and short rates are hidden', () => {
  const daily = Array.from({ length: 28 }, (_, index) => sourceDay(shiftDate('2026-10-01', index), { weight: 75 + index / 10 }));
  const selected = selectPeriod({ daily, training: [] }, '2026-10-15', '2026-10-28');
  assert.equal(selected.daily.length, 14);
  assert.equal(selected.previous.length, 14);
  assert.equal(selected.previousStart, '2026-10-01');
  assert.equal(selected.previousEnd, '2026-10-14');
  assert.ok(Math.abs(selected.rate - 0.7) < 1e-10);
  assert.equal(selectPeriod({ daily, training: [] }, '2026-10-15', '2026-10-20').rate, null);
  assert.throws(() => selectPeriod({ daily, training: [] }, '2026-10-20', '2026-10-15'), /start date/);
  assert.throws(() => selectPeriod({ daily, training: [] }, '', '2026-10-15'), /start date/);
  assert.equal(dateKey('2026-02-30'), null);
});

test('lagged relationships require consecutive dates and never invent missing weights', () => {
  const daily = [
    sourceDay('2026-10-01', { weight: 75, carbs: 200 }),
    sourceDay('2026-10-02', { weight: 75.5, carbs: 250 }),
    sourceDay('2026-10-04', { weight: 76, carbs: 300 }),
  ];
  const period = selectPeriod({ daily, training: [session('2026-10-02'), session('2026-10-04')] }, '2026-10-01', '2026-10-04');
  assert.deepEqual(relationship(period, 'carbsWeight').points, [{ x: 200, y: 0.5, label: '2026-10-02' }]);
  assert.equal(relationship(period, 'carbsTraining', 'Chest').points.length, 1);
  const narrow = selectPeriod({ daily, training: [] }, '2026-10-02', '2026-10-04');
  assert.equal(relationship(narrow, 'carbsWeight').points.length, 0);
});

test('failure relationships retain explicit zero, exclude missing counts, and match workout type', () => {
  const training = [
    session('2026-10-01', { failure: 0 }),
    session('2026-10-02', { workout: 'Legs', failure: 10, volume: 15000 }),
    session('2026-10-05', { volume: 5500 }),
    session('2026-10-10', { volume: 6000 }),
  ];
  const period = selectPeriod({ daily: [], training }, '2026-10-01', '2026-10-15');
  const failure = relationship(period, 'failure', 'Chest');
  assert.equal(failure.points.length, 1);
  assert.equal(failure.points[0].x, 0);
  assert.ok(Math.abs(failure.points[0].y - 10) < 1e-10);
  assert.deepEqual(relationship(period, 'spacing', 'Chest').points.map((point) => point.x), [4, 5]);
});

test('strength relationships use one exercise and same-day measured weight only', () => {
  const daily = [sourceDay('2026-10-01'), sourceDay('2026-10-02', { weight: null }), sourceDay('2026-10-03')];
  const training = [
    session('2026-10-01', { best: parseBestSet('Bench Press: 100x5') }),
    session('2026-10-02', { best: parseBestSet('Bench Press: 100x6') }),
    session('2026-10-03', { best: parseBestSet('Leg Press: 200x6') }),
  ];
  const period = selectPeriod({ daily, training }, '2026-10-01', '2026-10-03');
  assert.equal(relationship(period, 'strength', 'All', 'Bench Press').points.length, 1);
});

test('weekly calorie correlation pairs the prior week with the following weight change', () => {
  const daily = Array.from({ length: 21 }, (_, index) => sourceDay(shiftDate('2026-10-16', index), {
    calories: 2400 + Math.floor(index / 7) * 100,
    weight: 75 + Math.floor(index / 7) * 0.2,
  }));
  const period = selectPeriod({ daily, training: [] }, '2026-10-16', '2026-11-05');
  const pairs = relationship(period, 'calories').points;
  assert.equal(pairs.length, 2);
  assert.deepEqual(pairs.map((point) => point.x), [2400, 2500]);
  assert.ok(pairs.every((point) => Math.abs(point.y - 0.2) < 1e-10));
});

test('correlation is withheld for fewer than five pairs and constant inputs', () => {
  assert.equal(pearson([{ x: 1, y: 2 }]), null);
  assert.equal(pearson(Array.from({ length: 5 }, (_, i) => ({ x: 1, y: i }))), null);
  assert.equal(pearson(Array.from({ length: 5 }, (_, i) => ({ x: i, y: -i }))), -1);
});
