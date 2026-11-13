import Chart from 'chart.js/auto';
import readExcelFile from 'read-excel-file/browser';
import {
  normalizeWorkbook, selectPeriod, calendar, rolling, mean, shiftDate,
  relationship, relationshipOptions, daysBetween,
} from './data.js';
import './style.css';

const $ = (selector) => document.querySelector(selector);
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const format = (value, digits = 1) => value === null || value === undefined ? '--' : Number(value).toLocaleString('en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const signed = (value, digits = 1) => value === null ? '--' : `${value > 0 ? '+' : ''}${format(value, digits)}`;
const shortDate = (date) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const colours = ['#197f70', '#e9a23b', '#607fc4', '#b86c8f', '#7b8d51', '#9c754d'];
const defaults = { mode: 'bulk', calories: 2600, protein: 170, min: 0.1, max: 0.2 };
const state = { data: null, fileName: '', tab: 'overview', start: '', end: '', workout: 'All', exercise: '', relation: 'calories', targets: { ...defaults } };
let charts = [];
let storageNotice = '';
try {
  const saved = localStorage.getItem('form-progress-targets');
  if (saved) {
    const targets = JSON.parse(saved);
    if (!validTargets(targets)) throw new Error('Stored targets are invalid.');
    state.targets = targets;
  }
} catch (error) {
  storageNotice = `Saved settings could not be loaded: ${error.message} Suggested targets are shown instead.`;
}

function validTargets(targets) {
  return targets && ['bulk', 'cut'].includes(targets.mode)
    && ['calories', 'protein', 'min', 'max'].every((key) => typeof targets[key] === 'number' && Number.isFinite(targets[key]))
    && targets.calories > 0 && targets.protein > 0 && targets.min <= targets.max
    && (targets.mode === 'bulk' ? targets.min >= 0 : targets.max <= 0);
}

$('#app').innerHTML = `
  <aside class="sidebar">
    <a class="brand" href="#" aria-label="GymNutritionAssistant home"><span class="brand-icon">g<span>.</span></span><span>GymNutrition<span class="brand-light">Assistant</span></span></a>
    <div class="sidebar-caption">YOUR PERSONAL TRAINING JOURNAL</div>
    <nav aria-label="Dashboard sections">
      <button class="nav-item active" data-tab="overview"><span class="nav-icon">&#9638;</span>Overview</button>
      <button class="nav-item" data-tab="body"><span class="nav-icon">&#8767;</span>Body & nutrition</button>
      <button class="nav-item" data-tab="training"><span class="nav-icon">&#8599;</span>Training</button>
      <button class="nav-item" data-tab="relationships"><span class="nav-icon">&#8944;</span>Relationships</button>
    </nav>
    <div class="sidebar-bottom"><span class="privacy-dot"></span> Local. Private. Yours.<p>Your workbook stays in this browser.<br>No accounts. No uploads.</p></div>
  </aside>
  <main>
    <header class="topbar"><span class="eyebrow">A LITTLE MORE CLARITY. EVERY WEEK.</span><button class="button subtle" id="print" disabled>Print / save PDF</button></header>
    <section class="page-heading"><div><p class="eyebrow" id="page-kicker">THE BIG PICTURE</p><h1 id="page-title">Progress, in perspective.</h1><p class="subtitle" id="page-subtitle">Less noise. A clearer view of your weight, nutrition and training.</p></div><span class="goal-pill" id="goal-pill"></span></section>
    <section class="source-bar" aria-label="Workbook source">
      <div class="source-icon" aria-hidden="true">&#9636;</div><div class="source-copy"><strong id="source-name">Your Excel. A fresh perspective.</strong><span id="source-info">Choose your workbook to get started. The original file is never changed.</span></div>
      <label class="button primary file-button">Open Excel<input id="file" type="file" accept=".xlsx" aria-label="Open or reload Excel workbook"></label>
    </section>
    <div id="status" role="status" aria-live="polite"></div>
    <section class="filters" aria-label="Date and goal filters" hidden>
      <div class="date-fields"><label>From<input type="date" id="start" required></label><span class="date-arrow" aria-hidden="true">&rarr;</span><label>To<input type="date" id="end" required></label><button class="button" id="apply-dates">Apply</button></div>
      <div class="range-buttons" aria-label="Quick date ranges"><button data-days="28">4 weeks</button><button data-days="56">8 weeks</button><button data-days="all" class="selected">All time</button></div>
      <button class="button subtle" id="targets-button">Goal & targets</button>
    </section>
    <div id="date-error" role="alert"></div>
    <div id="view">
      <section class="welcome card"><div class="welcome-art" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div><p class="eyebrow">FROM TRACKING TO UNDERSTANDING</p><h2>You have the data.<br>Let's find the bigger picture.</h2><p>Open your workbook above to explore trends, compare weeks,<br class="desktop"> and see how your nutrition and training move together.</p><div class="welcome-tags"><span>Weight & waist</span><span>Nutrition trends</span><span>Training progress</span></div><p class="fine-print">Reads the Daily and Training sheets. Save changes in Excel, then select the file again to refresh.</p></section>
    </div>
    <footer>Built around your journal, not another tracking habit.<span>Trends are context, not a medical assessment.</span><span id="build-version"></span></footer>
  </main>
  <dialog id="targets-dialog"><form id="targets-form"><div class="dialog-heading"><div><p class="eyebrow">YOUR DIRECTION</p><h2>Goal & targets</h2></div><button type="button" class="icon-button" id="close-targets" aria-label="Close settings">&times;</button></div>
    <p class="muted">Starting suggestions come from your Weekly Review, not the older Dashboard targets. These are editable reference bands, not prescribed nutrition advice.</p>
    <label>Current goal<select name="mode"><option value="bulk">Lean bulk</option><option value="cut">Fat loss</option></select></label>
    <div class="form-grid"><label>Calories / day<input name="calories" type="number" min="1" step="1" required></label><label>Protein / day (g)<input name="protein" type="number" min="1" step="1" required></label><label>Weekly change: lower (kg)<input name="min" type="number" step="0.05" required></label><label>Weekly change: upper (kg)<input name="max" type="number" step="0.05" required></label></div>
    <p class="fine-print">Use positive rates for a bulk and negative rates for fat loss. Switching goals suggests a rate band but does not guess your calorie needs. Only these settings are saved on this browser.</p><p id="targets-error" role="alert"></p>
    <button class="button primary" type="submit">Save targets</button></form></dialog>
`;

Chart.defaults.font.family = "'Segoe UI', system-ui, sans-serif";
Chart.defaults.color = '#718078';
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.boxWidth = 7;
Chart.defaults.plugins.legend.labels.padding = 20;

function notice(message, error = false) {
  $('#status').className = message ? `notice${error ? ' error' : ''}` : '';
  $('#status').textContent = message;
}
if (storageNotice) notice(storageNotice, true);

function updateGoal() { $('#goal-pill').textContent = `${state.targets.mode === 'bulk' ? 'Lean bulk' : 'Fat loss'} · ${signed(state.targets.min)} to ${signed(state.targets.max)} kg/week`; }
updateGoal();
$('#build-version').textContent = `Build ${__APP_VERSION__}`;

$('#file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  notice('Reading your workbook locally...');
  event.target.disabled = true;
  try {
    if (!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('Please choose an .xlsx workbook.');
    if (file.size > 20 * 1024 * 1024) throw new Error('This dashboard supports workbooks up to 20 MB.');
    const sheets = await readExcelFile(file);
    const daily = sheets.find((sheet) => sheet.sheet === 'Daily');
    const training = sheets.find((sheet) => sheet.sheet === 'Training');
    if (!daily || !training) throw new Error('The workbook must contain sheets named Daily and Training.');
    const data = normalizeWorkbook(daily.data, training.data);
    const reloading = state.fileName === file.name;
    state.data = data;
    state.fileName = file.name;
    if (!reloading) { state.start = data.start; state.end = data.end; }
    state.workout = 'All';
    const exercises = exerciseNames();
    state.exercise = exercises.includes('Bench Press') ? 'Bench Press' : exercises[0] ?? '';
    $('#source-name').textContent = file.name;
    $('#source-info').textContent = `${data.daily.length} dated daily entries · ${data.training.length} sessions · Read at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Reselect after saving Excel.`;
    $('.filters').hidden = false;
    $('#print').disabled = false;
    syncDates();
    render();
    notice(data.issues.length ? `Imported with ${data.issues.length} data-quality notice(s). See the data notes below.` : 'Workbook loaded. All charts are recalculated from Daily and Training, not cached dashboard formulas.');
  } catch (error) {
    notice(`Could not import workbook: ${error.message}${state.data ? ' Your previously loaded workbook remains displayed.' : ''}`, true);
  } finally {
    event.target.disabled = false;
    event.target.value = '';
  }
});

function syncDates() {
  $('#start').value = state.start;
  $('#end').value = state.end;
  $('#date-error').textContent = '';
  document.querySelectorAll('[data-days]').forEach((button) => {
    const active = button.dataset.days === 'all'
      ? state.start === state.data.start && state.end === state.data.end
      : daysBetween(state.start, state.end) + 1 === Number(button.dataset.days) && state.end === state.data.end;
    button.classList.toggle('selected', active);
  });
}

$('#apply-dates').addEventListener('click', () => {
  try {
    selectPeriod(state.data, $('#start').value, $('#end').value);
    state.start = $('#start').value; state.end = $('#end').value;
    syncDates(); render();
  } catch (error) { $('#date-error').textContent = error.message; }
});
document.querySelectorAll('[data-days]').forEach((button) => button.addEventListener('click', () => {
  state.end = state.data.end;
  state.start = button.dataset.days === 'all' ? state.data.start : shiftDate(state.end, 1 - Number(button.dataset.days));
  syncDates(); render();
}));
document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => {
  state.tab = button.dataset.tab;
  document.querySelectorAll('[data-tab]').forEach((item) => { item.classList.toggle('active', item === button); item.setAttribute('aria-current', item === button ? 'page' : 'false'); });
  if (state.data) render();
}));
$('.brand').addEventListener('click', (event) => { event.preventDefault(); $('[data-tab="overview"]').click(); });
$('#print').addEventListener('click', () => window.print());
$('#targets-button').addEventListener('click', () => {
  const form = $('#targets-form');
  Object.entries(state.targets).forEach(([key, value]) => { form.elements[key].value = value; });
  $('#targets-error').textContent = '';
  $('#targets-dialog').showModal();
});
$('#close-targets').addEventListener('click', () => $('#targets-dialog').close());
$('#targets-form').elements.mode.addEventListener('change', (event) => {
  const form = $('#targets-form');
  form.elements.min.value = event.target.value === 'bulk' ? 0.1 : -0.5;
  form.elements.max.value = event.target.value === 'bulk' ? 0.2 : -0.2;
});
$('#targets-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.target;
  const targets = Object.fromEntries(['mode', 'calories', 'protein', 'min', 'max'].map((key) => [key, key === 'mode' ? form.elements[key].value : Number(form.elements[key].value)]));
  if (!validTargets(targets)) { $('#targets-error').textContent = 'Check your positive calorie/protein targets and ordered rate band. Bulk rates must be nonnegative; fat-loss rates must be nonpositive.'; return; }
  state.targets = targets;
  try { localStorage.setItem('form-progress-targets', JSON.stringify(targets)); notice('Targets saved on this browser. Your workbook has not been changed.'); }
  catch (error) { notice(`Targets applied for this visit, but could not be saved: ${error.message}`, true); }
  updateGoal(); $('#targets-dialog').close(); render();
});

function exerciseNames() {
  return [...new Set(state.data.training.filter((row) => row.best).map((row) => row.best.exercise))].sort();
}
function selectHtml(id, label, options, value) {
  return `<label class="inline-select">${label}<select id="${id}">${options.map((option) => `<option value="${escape(option.value ?? option)}" ${(option.value ?? option) === value ? 'selected' : ''}>${escape(option.label ?? option)}</option>`).join('')}</select></label>`;
}
function trainingFilters(includeExercise = true) {
  return `<div class="section-controls">${selectHtml('workout', 'Workout type', ['All', ...new Set(state.data.training.map((row) => row.workout))], state.workout)}${includeExercise ? selectHtml('exercise', 'Recorded exercise', exerciseNames(), state.exercise) : ''}</div>`;
}
function bindTrainingFilters() {
  $('#workout')?.addEventListener('change', (event) => { state.workout = event.target.value; render(); });
  $('#exercise')?.addEventListener('change', (event) => { state.exercise = event.target.value; render(); });
}
function card(id, title, description, wide = false) {
  return `<section class="card chart-card${wide ? ' wide' : ''}"><h2>${title}</h2><p class="chart-description">${description}</p><div class="chart-wrap"><canvas id="${id}" role="img" aria-label="${escape(title)}"></canvas></div></section>`;
}
function metric(title, value, unit, detail, accent = false) {
  return `<section class="metric${accent ? ' accent' : ''}"><p>${title}</p><div class="metric-value">${value}<span>${unit}</span></div><small>${detail}</small></section>`;
}
function line(label, data, colour = colours[0], options = {}) {
  return { label, data, borderColor: colour, backgroundColor: `${colour}18`, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0.2, spanGaps: false, ...options };
}
function target(label, value, length, colour = '#b99b6f') {
  return line(label, Array(length).fill(value), colour, { borderDash: [5, 5], borderWidth: 1.2 });
}
function chart(id, labels, datasets, { type = 'line', yTitle = '', secondary = '', zero = false } = {}) {
  const canvas = $(`#${id}`);
  const hasData = datasets.some((dataset) => dataset.data.some((value) => value !== null && value !== undefined));
  if (!hasData) {
    canvas.parentElement.innerHTML = '<div class="chart-empty">No measurements for this selection.<br><span>Try a wider date range or another exercise.</span></div>';
    return;
  }
  charts.push(new Chart(canvas, {
    type, data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ${format(context.parsed.y, 2)}` } } },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 9, maxRotation: 0 } },
        y: { beginAtZero: zero, title: { display: Boolean(yTitle), text: yTitle }, grid: { color: '#edf0eb' }, border: { display: false } },
        ...(secondary ? { y1: { position: 'right', title: { display: true, text: secondary }, grid: { drawOnChartArea: false }, border: { display: false } } } : {}),
      },
    },
  }));
}

function weightChart(period, id = 'weight-chart') {
  const dates = calendar(period.start, period.end);
  const entries = new Map(period.daily.map((row) => [row.date, row]));
  chart(id, dates.map(shortDate), [
    line('Morning weight', dates.map((date) => entries.get(date)?.weight ?? null), '#b7c9c0', { pointRadius: 2, borderWidth: 1 }),
    line('7-day average', dates.map((date) => rolling(state.data.daily, date, 'weight')), colours[0], { borderWidth: 3 }),
  ], { yTitle: 'kg' });
}

function weeklyTable(period) {
  return `<section class="card table-card"><div class="section-heading"><div><h2>Your weekly check-in</h2><p class="chart-description">Friday-Thursday. Weekly change requires two complete weeks, each with at least 5 weigh-ins.</p></div><span class="badge">${period.weeks.length} weeks</span></div>
    <div class="table-scroll"><table><thead><tr><th>Week starting</th><th>Avg weight</th><th>Change</th><th>Avg kcal</th><th>Waist*</th><th>Sessions</th><th>Coverage</th></tr></thead><tbody>${period.weeks.map((week) => `<tr><td>${shortDate(week.date)} <span class="table-year">${week.date.slice(0, 4)}</span></td><td>${format(week.weight)} kg</td><td>${signed(week.change, 2)} kg</td><td>${format(week.calories, 0)}</td><td>${format(week.waist)} cm</td><td>${week.sessions}</td><td><span class="coverage ${week.partial || week.weightCount < 5 ? 'limited' : ''}">${week.weightCount}/7 weights · ${week.calorieCount}/7 kcal${week.partial ? ' · partial' : ''}</span></td></tr>`).join('')}</tbody></table></div><p class="fine-print">* First available waist measurement in that week. Incomplete weeks are displayed, not extrapolated. No workout entry means no recorded session, not a confirmed rest day.</p></section>`;
}

function qualityNotes(period) {
  const macroMismatch = period.daily.filter((row) => [row.calories, row.carbs, row.protein, row.fat].every((v) => v !== null)
    && Math.abs(row.calories - (4 * row.carbs + 4 * row.protein + 9 * row.fat)) > Math.max(100, row.calories * 0.1)).length;
  return `<details class="data-notes"><summary>About your data & calculations${state.data.issues.length ? ` · ${state.data.issues.length} import notices` : ''}</summary><ul>
    <li>${period.daily.filter((row) => row.weight !== null).length}/${period.length} days with weight; ${period.daily.filter((row) => row.calories !== null).length}/${period.length} with calories; ${period.training.filter((row) => row.best).length}/${period.training.length} sessions with a parseable best set.</li>
    <li>Missing values stay missing, including missing failure counts. Nutrition is joined from Daily; Training lookup zeros and cached dashboard summaries are not used.</li>
    <li>Rolling averages use available readings in the previous 7 calendar days, including context before the chosen start date. Gaps are not filled. Very sparse windows can still have an average.</li>
    <li>${macroMismatch} logged days differ from macro-derived calories by more than 100 kcal or 10% (whichever is larger). Differences can include fibre, rounding or logging errors; check Excel.</li>
    <li>Estimated 1RM uses Epley for 2-12 reps, actual load for singles; estimates above 12 reps are omitted. Only the recorded best exercise is available per session. Different machines and exercise names are not merged.</li>
    <li>BIA body composition is hydration-sensitive. Fat mass, lean mass and skeletal muscle definitions may differ; they are not added together or treated as independently measured tissue.</li>
    <li>Older training entries may include warm-ups. Missing workload values are excluded from totals; volume comparisons need consistent exercises and equipment.</li>
    <li>Targets are editable suggestions. The workbook contains different targets on different sheets; source entries take precedence over old summaries.</li>
    ${state.data.issues.map((issue) => `<li>${escape(issue)}</li>`).join('')}</ul></details>`;
}

function overview(period) {
  const weights = period.daily.filter((row) => row.weight !== null);
  const delta = period.averageWeight !== null && period.previousWeight !== null ? period.averageWeight - period.previousWeight : null;
  const proteinRows = period.daily.filter((row) => row.protein !== null);
  const proteinHit = proteinRows.length ? proteinRows.filter((row) => row.protein >= state.targets.protein).length / proteinRows.length * 100 : null;
  const rateText = period.rate === null ? 'Not enough data for a reliable rate'
    : period.rate >= state.targets.min && period.rate <= state.targets.max ? 'Within your chosen rate band'
      : period.rate < state.targets.min ? 'Below your chosen rate band' : 'Above your chosen rate band';
  const waist = period.daily.filter((row) => row.waist !== null);
  const waistText = waist.length >= 2 ? `Waist moved ${signed(waist.at(-1).waist - waist[0].waist)} cm across ${waist.length} measurements.` : 'More waist measurements will help put weight changes in context.';
  $('#view').innerHTML = `<div class="metrics">
    ${metric('Average body weight', format(period.averageWeight), 'kg', delta !== null ? `${signed(delta)} kg vs previous period (${period.previous.filter((row) => row.weight !== null).length} readings)` : `${weights.length} weigh-ins · no previous-period weight data`, true)}
    ${metric('Weight trend', signed(period.rate, 2), 'kg / week', rateText)}
    ${metric('Average daily intake', format(period.calories, 0), 'kcal', `Reference target: ${format(state.targets.calories, 0)} kcal / day`)}
    ${metric('Training consistency', format(period.training.length / (period.length / 7)), '/ week', `${period.training.length} recorded sessions in ${period.length} days`)}
    </div>
    <div class="chart-grid overview-grid">${card('weight-chart', 'The trend, not the fluctuations', 'Morning measurements with a 7-day rolling average. Hover to explore.')}
      <section class="card insights"><p class="eyebrow">YOUR PERIOD IN PERSPECTIVE</p><h2>A few things to take away.</h2><div class="insight"><span class="insight-number">01</span><div><h3>${rateText}</h3><p>${period.rate === null ? 'Rate needs at least 14 days and 5 weigh-ins in both the first and last 7-day windows.' : `Your estimated pace is ${signed(period.rate, 2)} kg/week (${signed(period.ratePercent, 2)}% of starting weight). Review several weeks before changing your plan.`}</p></div></div>
      <div class="insight"><span class="insight-number">02</span><div><h3>Keep the context alongside the scale</h3><p>${waistText} Weight alone cannot separate muscle, fat and water.</p></div></div>
      <div class="insight"><span class="insight-number">03</span><div><h3>${proteinHit === null ? 'Protein logging is missing' : `${format(proteinHit, 0)}% of logged days met your protein target`}</h3><p>${proteinRows.length} days logged. Missing days are excluded, not counted as missed targets.</p></div></div></section></div>
    <div class="chart-grid">${card('weekly-change', 'Is the pace right for your goal?', 'Week-to-week average weight change, with your editable reference band.')}${card('weekly-training', 'Showing up, week by week', 'Recorded sessions per Friday-Thursday week. Edge weeks may be partial.')}</div>
    ${weeklyTable(period)}${qualityNotes(period)}`;
  weightChart(period);
  const labels = period.weeks.map((week) => shortDate(week.date));
  chart('weekly-change', labels, [
    { label: 'Weekly change (kg)', data: period.weeks.map((week) => week.change), backgroundColor: '#197f70b0', borderRadius: 4 },
    { ...target('Lower target', state.targets.min, labels.length), type: 'line' },
    { ...target('Upper target', state.targets.max, labels.length), type: 'line' },
  ], { type: 'bar', yTitle: 'kg / week', zero: true });
  chart('weekly-training', labels, [{ label: 'Recorded sessions', data: period.weeks.map((week) => week.sessions), backgroundColor: '#607fc4a6', borderRadius: 5 }], { type: 'bar', zero: true });
}

function body(period) {
  const waist = period.daily.filter((row) => row.waist !== null);
  $('#view').innerHTML = `<div class="section-note"><strong>Read the trend over weeks.</strong> Body-composition numbers are estimates. Water shifts can look like muscle or fat changes.</div><div class="chart-grid">
    ${card('weight-chart', 'Weight, without the noise', 'Daily readings and a 7-day calendar-window average.')}
    ${card('waist-chart', 'Weight & waist in context', `${waist.length} waist measurements in this range. Sparse measurements are shown as points, not filled in.`)}
    ${card('calorie-chart', 'Fueling your direction', 'Daily calories, 7-day average and your editable calorie reference.')}
    ${card('macro-chart', 'Your nutrition rhythm', '7-day averages in grams. Protein target applies to the protein line only.')}
    ${card('protein-chart', 'Protein relative to body weight', 'Daily protein / same-day weight. Missing pairs are excluded; no weight is carried forward.')}
    ${card('composition-chart', 'Body-composition estimates', 'Fat and skeletal muscle estimates on separate axes. Not independently measured tissue.')}
    ${card('water-chart', 'Hydration & the muscle estimate', 'Look for coinciding movements, not proof of actual muscle gain.')}
    ${card('bodyfat-chart', 'Body-fat estimate over time', 'Raw BIA readings with a 7-day average. Assess over several weeks, not a single day.')}
    </div>${qualityNotes(period)}`;
  weightChart(period);
  const dates = calendar(period.start, period.end);
  const labels = dates.map(shortDate);
  const byDate = new Map(period.daily.map((row) => [row.date, row]));
  const values = (key) => dates.map((date) => byDate.get(date)?.[key] ?? null);
  const smooth = (key) => dates.map((date) => rolling(state.data.daily, date, key));
  chart('waist-chart', labels, [line('7-day weight (kg)', smooth('weight')), line('Waist (cm)', values('waist'), colours[1], { yAxisID: 'y1', showLine: false, pointRadius: 5 })], { yTitle: 'Weight (kg)', secondary: 'Waist (cm)' });
  chart('calorie-chart', labels, [line('Daily kcal', values('calories'), '#c2d0c8', { pointRadius: 2 }), line('7-day kcal', smooth('calories')), target('Calorie target', state.targets.calories, labels.length)], { yTitle: 'kcal / day' });
  chart('macro-chart', labels, [line('Carbs', smooth('carbs'), colours[2]), line('Protein', smooth('protein')), line('Fat', smooth('fat'), colours[1]), target('Protein target', state.targets.protein, labels.length)], { yTitle: 'grams / day', zero: true });
  chart('protein-chart', labels, [line('Protein / body weight', dates.map((date) => { const row = byDate.get(date); return row?.protein !== null && row?.protein !== undefined && row.weight > 0 ? row.protein / row.weight : null; }), colours[0], { pointRadius: 2 })], { yTitle: 'g / kg' });
  chart('composition-chart', labels, [line('Fat mass (kg)', values('fatMass'), colours[1], { pointRadius: 2 }), line('Skeletal muscle (kg)', values('muscle'), colours[0], { yAxisID: 'y1', pointRadius: 2 })], { yTitle: 'Fat mass (kg)', secondary: 'Muscle estimate (kg)' });
  chart('water-chart', labels, [line('Body water (%)', values('water'), colours[2], { pointRadius: 2 }), line('Skeletal muscle (kg)', values('muscle'), colours[0], { yAxisID: 'y1', pointRadius: 2 })], { yTitle: 'Body water (%)', secondary: 'Muscle estimate (kg)' });
  chart('bodyfat-chart', labels, [line('Body fat (%)', values('bodyFat'), '#d3b9a2', { pointRadius: 2 }), line('7-day average', smooth('bodyFat'), colours[1])], { yTitle: '%' });
}

function training(period) {
  const sessions = period.training.filter((row) => state.workout === 'All' || row.workout === state.workout);
  const strength = sessions.filter((row) => row.best?.exercise === state.exercise);
  const dates = calendar(period.start, period.end);
  const counts = new Map(dates.map((date) => [date, period.training.filter((row) => row.date === date).length]));
  $('#view').innerHTML = `${trainingFilters()}<div class="section-note"><strong>Compare like with like.</strong> Strength uses only the single best set recorded in each session. Missing recent best sets are not evidence of a plateau. Workout filters apply below; the calendar shows all sessions.</div>
    <div class="chart-grid">${card('strength-chart', 'Your recorded strength trajectory', `${escape(state.exercise || 'No exercise recorded')} · Epley estimates for 2-12 reps; singles use actual load.`)}
    ${card('relative-chart', 'Strength relative to body weight', 'Same-day weight only. Helpful context during a cut, not a replacement for absolute strength.')}
    ${card('volume-chart', 'Workload by workout type', 'Session load volume, with each workout type kept separate. Exercise changes still matter.')}
    ${card('sets-chart', 'How much work, how much time?', 'Recorded working sets and duration per session. Older entries may include warm-ups.')}</div>
    <section class="card calendar-card"><h2>Your training rhythm</h2><p class="chart-description">All workouts in the chosen range. A light square means no recorded session, not a confirmed rest day.</p><div class="calendar-grid" aria-label="Training days">${dates.map((date) => `<span tabindex="0" class="calendar-day ${counts.get(date) ? 'trained' : ''}" title="${date}: ${counts.get(date)} recorded sessions" aria-label="${date}: ${counts.get(date)} recorded sessions">${new Date(`${date}T00:00:00Z`).getUTCDate() === 1 || date === dates[0] ? escape(shortDate(date)) : ''}</span>`).join('')}</div><div class="calendar-legend"><span>Less</span><i></i><i class="trained"></i><span>Recorded training</span></div></section>
    <section class="card table-card"><h2>Behind the strength line</h2><p class="chart-description">Only recorded ${escape(state.exercise || 'exercise')} best sets, not your complete exercise history. Estimates do not account for effort or form.</p><div class="table-scroll"><table><thead><tr><th>Date</th><th>Workout</th><th>Top set</th><th>Estimated 1RM</th><th>Body weight</th></tr></thead><tbody>${strength.map((row) => `<tr><td>${row.date}</td><td>${escape(row.workout)}</td><td>${format(row.best.load)} kg &times; ${row.best.reps}</td><td>${format(row.best.e1rm)} kg</td><td>${format(period.daily.find((day) => day.date === row.date)?.weight)} kg</td></tr>`).join('') || '<tr><td colspan="5">No recorded best sets for this selection.</td></tr>'}</tbody></table></div></section>${qualityNotes(period)}`;
  bindTrainingFilters();
  // Keep unrecorded sessions as nulls rather than drawing strength through the missing history.
  chart('strength-chart', sessions.map((row) => shortDate(row.date)), [
    line('Estimated 1RM (kg)', sessions.map((row) => row.best?.exercise === state.exercise ? row.best.e1rm : null), colours[0], { pointRadius: 4 }),
    line('Top-set load (kg)', sessions.map((row) => row.best?.exercise === state.exercise ? row.best.load : null), colours[2], { pointRadius: 3 }),
  ], { yTitle: 'kg' });
  chart('relative-chart', sessions.map((row) => shortDate(row.date)), [line('Estimated 1RM / body weight', sessions.map((row) => {
    const weight = period.daily.find((day) => day.date === row.date)?.weight;
    return row.best?.exercise === state.exercise && row.best.e1rm !== null && weight > 0 ? row.best.e1rm / weight : null;
  }), colours[2], { pointRadius: 4 })], { yTitle: 'times body weight' });
  const workouts = [...new Set(sessions.map((row) => row.workout))];
  chart('volume-chart', sessions.map((row) => shortDate(row.date)), workouts.map((workout, index) => line(workout, sessions.map((row) => row.workout === workout ? row.volume : null), colours[index % colours.length], { pointRadius: 4, showLine: state.workout !== 'All' })), { yTitle: 'Load volume (kg)' });
  chart('sets-chart', sessions.map((row) => shortDate(row.date)), [line('Working sets', sessions.map((row) => row.sets), colours[0], { pointRadius: 2 }), line('Duration (min)', sessions.map((row) => row.duration), colours[1], { yAxisID: 'y1', pointRadius: 2 })], { yTitle: 'Sets', secondary: 'Minutes', zero: true });
}

function relationships(period) {
  const needsWorkout = ['carbsTraining', 'spacing', 'failure', 'duration'].includes(state.relation);
  const needsExercise = state.relation === 'strength';
  const result = relationship(period, state.relation, needsWorkout ? state.workout : 'All', state.exercise);
  const mixed = needsWorkout && state.workout === 'All' && state.relation !== 'duration';
  const r = mixed ? null : result.r;
  $('#view').innerHTML = `<div class="section-controls">${selectHtml('relation', 'Explore a relationship', Object.entries(relationshipOptions).map(([value, option]) => ({ value, label: option.title })), state.relation)}${needsWorkout ? selectHtml('workout', 'Compare the same workout', ['All', ...new Set(state.data.training.map((row) => row.workout))], state.workout) : ''}${needsExercise ? selectHtml('exercise', 'Recorded exercise', exerciseNames(), state.exercise) : ''}</div>
    <div class="section-note"><strong>Patterns, not prescriptions.</strong> Correlations do not establish cause. Every pair uses actual observations within the chosen date range; missing data is excluded.</div>
    <div class="relationship-layout">${card('scatter-chart', escape(result.title), escape(result.note))}
    <section class="card relationship-summary"><p class="eyebrow">READING THE RELATIONSHIP</p><h2>What the dots say.</h2><div class="relationship-number">${result.points.length}<span>paired observations</span></div><div class="relationship-number">${r === null ? '--' : format(r, 2)}<span>Pearson correlation (r)</span></div><p>${mixed ? 'Select one workout type to see a correlation. Mixing leg, chest and other sessions would distort the result.' : result.points.length < 5 ? 'Too few pairs to show a correlation. Try a wider date range.' : r === null ? 'A correlation cannot be calculated when either measurement has no variation.' : 'The coefficient describes this sample only. It is not a prediction or evidence that one variable caused the other.'}</p><p class="fine-print">${result.points.length < 20 ? 'Small sample: interpret cautiously. ' : ''}Repeated observations from one person and time trends limit interpretation. No statistical significance or causal claim is made.</p></section></div>
    <details class="data-notes"><summary>See paired observations</summary><div class="table-scroll"><table><thead><tr><th>Date / session</th><th>${escape(result.x)}</th><th>${escape(result.y)}</th></tr></thead><tbody>${result.points.map((point) => `<tr><td>${escape(point.label)}</td><td>${format(point.x, 2)}</td><td>${format(point.y, 2)}</td></tr>`).join('') || '<tr><td colspan="3">No matching pairs in this range.</td></tr>'}</tbody></table></div></details>${qualityNotes(period)}`;
  $('#relation').addEventListener('change', (event) => { state.relation = event.target.value; render(); });
  bindTrainingFilters();
  if (!result.points.length) { $('#scatter-chart').parentElement.innerHTML = '<div class="chart-empty">No matching observations.<br><span>Try a wider date range or a different selection.</span></div>'; return; }
  charts.push(new Chart($('#scatter-chart'), {
    type: 'scatter',
    data: { datasets: [{ label: 'Observed pair', data: result.points, backgroundColor: '#197f7099', borderColor: colours[0], pointRadius: 5, pointHoverRadius: 7 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => `${context.raw.label}: ${format(context.raw.x, 2)}, ${format(context.raw.y, 2)}` } } },
      scales: { x: { title: { display: true, text: result.x }, grid: { color: '#edf0eb' } }, y: { title: { display: true, text: result.y }, grid: { color: '#edf0eb' } } },
    },
  }));
}

function render() {
  charts.forEach((instance) => instance.destroy());
  charts = [];
  const period = selectPeriod(state.data, state.start, state.end);
  const headings = {
    overview: ['THE BIG PICTURE', 'Progress, in perspective.', 'Less noise. A clearer view of your weight, nutrition and training.'],
    body: ['THE FOUNDATIONS', 'Understand your body.', 'Put your weight, nutrition and measurements in the same picture.'],
    training: ['THE WORK YOU PUT IN', 'Show up. Build momentum.', 'Follow comparable sessions and the strength you have recorded.'],
    relationships: ['CONNECT THE DOTS', 'Explore what moves together.', 'Thoughtful comparisons, with the limitations left in plain sight.'],
  };
  const [kicker, title, subtitle] = headings[state.tab];
  $('#page-kicker').textContent = kicker;
  $('#page-title').textContent = title;
  $('#page-subtitle').textContent = `${subtitle} ${shortDate(period.start)} ${period.start.slice(0, 4)} - ${shortDate(period.end)} ${period.end.slice(0, 4)}.`;
  if (!period.daily.length && !period.training.length) {
    $('#view').innerHTML = '<section class="card empty-state"><h2>No entries in this date range</h2><p>Choose another range or use All time. Missing entries are not treated as zeros.</p></section>';
    return;
  }
  ({ overview, body, training, relationships }[state.tab])(period);
}
