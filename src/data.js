const DAY = 86_400_000;

export function number(value) {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim()) || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function dateKey(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && value > 0) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * DAY).toISOString().slice(0, 10);
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value) return value;
  }
  return null;
}

export function shiftDate(date, days) {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY).toISOString().slice(0, 10);
}

export function daysBetween(start, end) {
  return Math.round((new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / DAY);
}

export function calendar(start, end) {
  const result = [];
  for (let date = start; date <= end; date = shiftDate(date, 1)) result.push(date);
  return result;
}

export const mean = (values) => {
  const valid = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
};

const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] ?? 0), 0);
const within = (row, start, end) => row.date >= start && row.date <= end;

const dailyFields = {
  calories: 'Cal', weight: 'Kg', carbs: 'Carbs', protein: 'Protein', fat: 'Fat',
  bodyFat: 'Body Fat %', fatMass: 'Fat Mass kg', leanMass: 'Lean Mass kg',
  muscle: 'Skeletal Muscle kg', water: 'Body Water %', icw: 'ICW kg', ecw: 'ECW kg', waist: 'Waist cm',
};
const trainingFields = {
  duration: 'Duration min', exercises: 'Exercises', sets: 'Working sets',
  reps: 'Total reps', volume: 'Load volume kg', failure: 'Failure sets',
};

function objects(rows, required, sheet) {
  const headers = rows[0]?.map((cell) => String(cell ?? '').trim()) ?? [];
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`${sheet}: missing required columns: ${missing.join(', ')}.`);
  return rows.slice(1).map((cells, index) => ({
    row: index + 2,
    values: Object.fromEntries(headers.filter(Boolean).map((header) => [header, cells[headers.indexOf(header)] ?? null])),
  }));
}

export function parseBestSet(value) {
  if (!value) return null;
  const match = String(value).trim().match(/^(.+?)\s*:?\s+(\d+(?:\.\d+)?)\s*[x×]\s*(\d+)\s*$/i)
    ?? String(value).trim().match(/^(.+?):\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+)\s*$/i);
  if (!match) return null;
  const exercise = match[1].replace(/:$/, '').trim().replace(/\s+/g, ' ');
  const load = Number(match[2]);
  const reps = Number(match[3]);
  if (load <= 0 || reps < 1) return null;
  return { exercise, load, reps, e1rm: reps === 1 ? load : reps <= 12 ? load * (1 + reps / 30) : null };
}

export function normalizeWorkbook(dailyRows, trainingRows) {
  const issues = [];
  const daily = [];
  const training = [];
  const seen = new Set();
  for (const { row, values } of objects(dailyRows, ['Date', 'Cal', 'Kg'], 'Daily')) {
    if (!values.Date && !Object.values(dailyFields).some((field) => values[field] != null)) continue;
    const date = dateKey(values.Date);
    if (!date) { issues.push(`Daily row ${row}: invalid or missing date; excluded.`); continue; }
    if (seen.has(date)) throw new Error(`Daily contains duplicate entries for ${date}. Resolve them in Excel before importing.`);
    seen.add(date);
    const item = { date };
    for (const [key, column] of Object.entries(dailyFields)) {
      const raw = values[column];
      let value = number(raw);
      if (value !== null && (value < 0 || (['weight', 'waist'].includes(key) && value === 0)
        || (['bodyFat', 'water'].includes(key) && value > 100))) value = null;
      if (raw !== null && raw !== undefined && raw !== '' && value === null) {
        issues.push(`Daily ${date}: invalid ${column}; treated as missing.`);
      }
      item[key] = value;
    }
    daily.push(item);
  }
  const sessionKeys = new Set();
  for (const { row, values } of objects(trainingRows, ['Date', 'Workout', 'Working sets', 'Load volume kg'], 'Training')) {
    if (!values.Date && !values.Workout) continue;
    const date = dateKey(values.Date);
    if (!date) { issues.push(`Training row ${row}: invalid or missing date; excluded.`); continue; }
    const workout = String(values.Workout ?? '').trim();
    if (!workout) { issues.push(`Training ${date}: missing workout name; excluded.`); continue; }
    const item = { date, workout, best: parseBestSet(values['Best weighted set']) };
    if (values['Best weighted set'] && !item.best) issues.push(`Training ${date}: unrecognised best-set format; excluded from strength graphs.`);
    for (const [key, column] of Object.entries(trainingFields)) {
      const raw = values[column];
      const value = number(raw);
      item[key] = value !== null && value >= 0 ? value : null;
      if (raw !== null && raw !== undefined && raw !== '' && item[key] === null) {
        issues.push(`Training ${date}: invalid ${column}; treated as missing.`);
      }
    }
    if (item.failure !== null && item.sets !== null && item.failure > item.sets) {
      issues.push(`Training ${date}: failure sets exceed total sets; failure count excluded.`);
      item.failure = null;
    }
    const key = JSON.stringify(item);
    if (sessionKeys.has(key)) issues.push(`Training ${date}: identical session appears more than once; retained, please check Excel.`);
    sessionKeys.add(key);
    training.push(item);
  }
  if (!daily.length) throw new Error('No valid dated entries were found in Daily.');
  daily.sort((a, b) => a.date.localeCompare(b.date));
  training.sort((a, b) => a.date.localeCompare(b.date));
  const dates = [...daily, ...training].map((row) => row.date).sort();
  return { daily, training, issues, start: dates[0], end: dates.at(-1) };
}

export function rolling(rows, date, key, window = 7) {
  const start = shiftDate(date, -(window - 1));
  return mean(rows.filter((row) => within(row, start, date)).map((row) => row[key]));
}

export function weekStart(date) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return shiftDate(date, -((day + 2) % 7));
}

export function weekly(daily, training, start, end) {
  const weeks = [];
  for (let date = weekStart(start); date <= end; date = shiftDate(date, 7)) {
    const last = shiftDate(date, 6);
    const days = daily.filter((row) => within(row, date, last) && within(row, start, end));
    const sessions = training.filter((row) => within(row, date, last) && within(row, start, end));
    weeks.push({
      date, end: last, weight: mean(days.map((row) => row.weight)),
      calories: mean(days.map((row) => row.calories)),
      weightCount: days.filter((row) => row.weight !== null).length,
      calorieCount: days.filter((row) => row.calories !== null).length,
      waist: days.find((row) => row.waist !== null)?.waist ?? null,
      sessions: sessions.length, sets: sum(sessions, 'sets'), duration: sum(sessions, 'duration'),
      volume: sum(sessions, 'volume'), partial: date < start || last > end,
    });
  }
  return weeks.map((week, index) => ({
    ...week,
    change: index && week.weightCount >= 5 && weeks[index - 1].weightCount >= 5
      && !week.partial && !weeks[index - 1].partial ? week.weight - weeks[index - 1].weight : null,
  }));
}

export function selectPeriod(data, start, end) {
  if (!dateKey(start) || !dateKey(end) || start > end) throw new Error('Choose a valid start date on or before the end date.');
  const length = daysBetween(start, end) + 1;
  if (length > 3660) throw new Error('Please select a date range of 10 years or less.');
  const daily = data.daily.filter((row) => within(row, start, end));
  const training = data.training.filter((row) => within(row, start, end));
  const previousStart = shiftDate(start, -length);
  const previousEnd = shiftDate(start, -1);
  const previous = data.daily.filter((row) => within(row, previousStart, previousEnd));
  const first = daily.filter((row) => within(row, start, shiftDate(start, 6)) && row.weight !== null);
  const last = daily.filter((row) => within(row, shiftDate(end, -6), end) && row.weight !== null);
  const rate = length >= 14 && first.length >= 5 && last.length >= 5
    ? (mean(last.map((row) => row.weight)) - mean(first.map((row) => row.weight))) / ((length - 7) / 7) : null;
  return {
    start, end, length, daily, training, previousStart, previousEnd, previous,
    weeks: weekly(daily, training, start, end),
    averageWeight: mean(daily.map((row) => row.weight)),
    previousWeight: mean(previous.map((row) => row.weight)),
    calories: mean(daily.map((row) => row.calories)),
    protein: mean(daily.map((row) => row.protein)), rate,
    ratePercent: rate !== null ? rate / mean(first.map((row) => row.weight)) * 100 : null,
  };
}

export function pearson(points) {
  if (points.length < 5) return null;
  const mx = mean(points.map((point) => point.x));
  const my = mean(points.map((point) => point.y));
  let xx = 0, yy = 0, xy = 0;
  for (const point of points) {
    xx += (point.x - mx) ** 2;
    yy += (point.y - my) ** 2;
    xy += (point.x - mx) * (point.y - my);
  }
  return xx > 0 && yy > 0 ? Math.max(-1, Math.min(1, xy / Math.sqrt(xx * yy))) : null;
}

export const relationshipOptions = {
  calories: { title: 'Calories & subsequent weight change', x: 'Previous week average kcal/day', y: 'Next week weight change (kg)', note: 'Complete Friday-Thursday weeks only, with at least 5 weigh-ins and 5 calorie logs. Few weekly pairs and time trends limit interpretation.' },
  carbsTraining: { title: 'Carbs & next-day training', x: 'Previous-day carbs (g)', y: 'Session load volume (kg)', note: 'Filter one workout type. Different exercises, set counts and meal timing can explain differences; this is not a causal effect.' },
  carbsWeight: { title: 'Carbs & next-morning weight', x: 'Previous-day carbs (g)', y: 'Next-day weight change (kg)', note: 'Only consecutive days with both weights. Changes can reflect water, glycogen and food mass rather than fat.' },
  waterMuscle: { title: 'Water & estimated muscle changes', x: 'Daily body-water change (percentage points)', y: 'Daily estimated muscle change (kg)', note: 'Consecutive readings only. Both estimates come from the same BIA device, so this is not independent evidence of muscle change.' },
  strength: { title: 'Body weight & strength', x: 'Same-day morning weight (kg)', y: 'Estimated 1RM (kg)', note: 'One recorded exercise at a time. Epley estimate for 2-12 reps; singles use actual load. Time trends and effort affect this relationship.' },
  spacing: { title: 'Session spacing & workload', x: 'Days since previous matching workout', y: 'Next session load volume (kg)', note: 'Choose one workout type. Spacing is not a recovery measurement and workload is not a direct measure of strength.' },
  failure: { title: 'Failure sets & next-session workload', x: 'Previous matching session: failure sets (%)', y: 'Next session volume change (%)', note: 'Choose one workout type. Only explicitly logged failure counts are included. Exercise changes and warm-ups can distort the comparison.' },
  duration: { title: 'Session length & workload', x: 'Duration (minutes)', y: 'Working sets', note: 'Describes training density, not effectiveness. Older sessions may count warm-up sets.' },
};

export function relationship(period, kind, workout = 'All', exercise = '') {
  const points = [];
  const byDate = new Map(period.daily.map((row) => [row.date, row]));
  const sessions = period.training.filter((row) => workout === 'All' || row.workout === workout);
  const add = (x, y, label) => {
    if (x !== null && y !== null && Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y, label });
  };
  if (kind === 'calories') {
    period.weeks.forEach((week, index, weeks) => {
      const before = weeks[index - 1];
      if (before && !before.partial && before.calorieCount >= 5 && week.change !== null) {
        add(before.calories, week.change, `${before.date} → ${week.date}`);
      }
    });
  } else if (['carbsWeight', 'waterMuscle'].includes(kind)) {
    for (const today of period.daily) {
      const yesterday = byDate.get(shiftDate(today.date, -1));
      if (!yesterday) continue;
      if (kind === 'carbsWeight' && today.weight !== null && yesterday.weight !== null) {
        add(yesterday.carbs, today.weight - yesterday.weight, today.date);
      }
      if (kind === 'waterMuscle' && [today.water, yesterday.water, today.muscle, yesterday.muscle].every((v) => v !== null)) {
        add(today.water - yesterday.water, today.muscle - yesterday.muscle, today.date);
      }
    }
  } else {
    const previous = new Map();
    for (const session of sessions) {
      const label = `${session.date} · ${session.workout}`;
      const before = previous.get(session.workout);
      if (kind === 'carbsTraining') add(byDate.get(shiftDate(session.date, -1))?.carbs ?? null, session.volume, label);
      if (kind === 'strength' && session.best?.exercise === exercise) add(byDate.get(session.date)?.weight ?? null, session.best.e1rm, label);
      if (kind === 'duration') add(session.duration, session.sets, label);
      if (kind === 'spacing' && before) add(daysBetween(before.date, session.date), session.volume, label);
      if (kind === 'failure' && before && before.failure !== null && before.sets > 0 && before.volume > 0 && session.volume !== null) {
        add(before.failure / before.sets * 100, (session.volume / before.volume - 1) * 100, label);
      }
      previous.set(session.workout, session);
    }
  }
  return { ...relationshipOptions[kind], points, r: pearson(points) };
}
