(function () {
'use strict';
const F = window.Finance;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const money = (c) => (c < 0 ? '−' : '') + nf.format(Math.abs(c) / 100);
const signed = (c) => (c > 0 ? '+' : c < 0 ? '−' : '') + nf.format(Math.abs(c) / 100);
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');

/* mode: 'auth' (signed out), 'demo' (sample data, no server account), 'user' (a real account)
   source: where the numbers on screen came from: 'none', 'sample', 'bank' or 'csv' */
const st = { mode: 'auth', demoKind: '', cfg: {}, P: 'month', OFF: 0, FLT: 'all', Q: '', LIM: 50, DATA: [], source: 'none' };

/* ---------- Messages ---------- */
function say(text) { const n = $('notice'); n.textContent = text; n.hidden = false; }
function sayHtml(html) { const n = $('notice'); n.innerHTML = html; n.hidden = false; } // only ever called with fixed text
function clearNotice() { $('notice').hidden = true; $('notice').textContent = ''; }

/* ---------- Drawing the dashboard ---------- */
function deltaText(el, cur, prev, goodUp, what) {
  if (!cur && !prev) { el.textContent = ''; el.className = 'k-d'; return; }
  if (!prev) { el.textContent = 'Nothing in ' + what; el.className = 'k-d'; return; }
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  el.textContent = (pct > 0 ? '▲ ' : pct < 0 ? '▼ ' : '') + Math.abs(pct) + '% vs ' + what;
  el.className = 'k-d' + (pct === 0 ? '' : (pct > 0) === goodUp ? ' good' : ' bad');
}

function rowTags(x) {
  return (F.kindOf(x) === 'transfer' ? '<span class="tag xfer">Transfer</span>' : '') + (x.pending ? '<span class="tag">Pending</span>' : '');
}
function amountHtml(x) {
  const k = F.kindOf(x), cls = k === 'transfer' ? ' xfer' : k === 'income' ? ' in' : '';
  return '<span class="amt' + cls + '">' + signed(x.cents) + '</span>';
}
const KIND_NAMES = { income: 'Income', expense: 'Expense', transfer: 'Transfer' };
// The automatic guess, before any correction
const autoKind = (x) => F.kindOf(Object.assign({}, x, { kind: undefined }));
function kindSelect(x) {
  const k = F.kindOf(x), auto = autoKind(x), changed = k !== auto;
  return '<select class="kind' + (changed ? ' changed' : '') + '" data-id="' + esc(x.id) + '" aria-label="Counts as, ' + esc(x.desc) + '"' +
    (changed ? ' title="Changed by you. Automatically this was counted as ' + KIND_NAMES[auto].toLowerCase() + '."' : '') + '>' +
    F.KINDS.map((o) => '<option value="' + o + '"' + (o === k ? ' selected' : '') + '>' + KIND_NAMES[o] + (o === auto && changed ? ' (auto)' : '') + '</option>').join('') + '</select>';
}
const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);

function render() {
  const today = F.todayKey();
  const r = F.range(st.P, st.OFF, today);
  const cur = F.summarize(st.DATA, r);
  const cmp = F.comparison(st.P, st.OFF, today);
  const prev = F.summarize(st.DATA, cmp.prev);
  $('range').textContent = F.label(st.P, r);
  $('next').disabled = st.OFF >= 0;

  // Net cash flow, income, expenses
  const net = cur.netC;
  $('kNetCard').className = 'card kpi dark' + (net < 0 ? ' neg' : '');
  $('kNet').textContent = money(net);
  $('kNetS').textContent = !cur.incomeC && !cur.expenseC ? 'No income or expenses in this period'
    : net >= 0 ? 'Kept ' + money(net) + ' of ' + money(cur.incomeC) + ' income' : 'Spent ' + money(-net) + ' more than income';
  const what = cmp.label;
  deltaText($('kNetD'), net, prev.netC, true, what);
  $('kInc').textContent = money(cur.incomeC);
  $('kIncS').textContent = plural(cur.counts.income, 'deposit');
  deltaText($('kIncD'), cur.incomeC, prev.incomeC, true, what);
  $('kExp').textContent = money(cur.expenseC);
  $('kExpS').textContent = plural(cur.counts.expense, 'payment');
  deltaText($('kExpD'), cur.expenseC, prev.expenseC, false, what);

  $('cmpLine').textContent = cmp.partial
    ? F.spanLabel({ start: r.start, end: F.addDays(today, 1) }) + ' compared with ' + F.spanLabel(cmp.prev) + ' (same number of days)'
    : 'The whole ' + st.P + ' compared with the whole ' + st.P + ' before it';

  // What is deliberately not counted
  $('xferLine').textContent = cur.counts.transfer
    ? money(cur.transferInC) + ' in, ' + money(cur.transferOutC) + ' out (' + plural(cur.counts.transfer, 'transfer') + ', not counted above)'
    : 'None this period';
  const pend = [];
  if (cur.pendingOutC) pend.push(money(cur.pendingOutC) + ' out');
  if (cur.pendingInC) pend.push(money(cur.pendingInC) + ' in');
  $('pendLine').textContent = cur.pendingCount
    ? plural(cur.pendingCount, 'transaction') + ' (' + pend.join(', ') + '), counted once your bank posts ' + (cur.pendingCount === 1 ? 'it' : 'them')
    : 'None this period';

  donut(cur);

  const recent = cur.rows.slice().sort(byDateDesc).slice(0, 6);
  $('recent').innerHTML = recent.length ? recent.map((x) =>
    '<li><span class="d"><b>' + esc(x.desc) + '</b><small>' + F.formatDay(x.date) + ', ' + esc(F.displayCategory(x)) + rowTags(x) + '</small></span>' + amountHtml(x) + '</li>').join('')
    : '<li class="empty">No transactions in this period.</li>';

  // Transactions table
  const q = st.Q.trim().toLowerCase();
  const list = cur.rows.filter((x) => {
    const k = F.kindOf(x);
    if (st.FLT === 'in' && k !== 'income') return false;
    if (st.FLT === 'out' && k !== 'expense') return false;
    if (st.FLT === 'transfer' && k !== 'transfer') return false;
    return !q || (x.desc + ' ' + F.displayCategory(x)).toLowerCase().includes(q);
  }).sort(byDateDesc);
  $('tbody').innerHTML = list.length ? list.slice(0, st.LIM).map((x) =>
    '<tr class="' + (x.pending ? 'is-pending' : '') + '"><td class="dt">' + F.formatDay(x.date) + '</td><td>' + esc(x.desc) + rowTags(x) +
    '<small>' + esc(F.displayCategory(x)) + '</small><span class="m-kind">' + kindSelect(x) + '</span></td><td class="c-cat"><span>' + esc(F.displayCategory(x)) + '</span></td><td class="c-kind">' + kindSelect(x) + '</td><td class="r">' + amountHtml(x) + '</td></tr>').join('')
    : '<tr><td colspan="5" class="empty">' + (st.DATA.length ? 'No transactions match. Try another period, filter or search.' : 'No transactions yet.') + '</td></tr>';
  $('count').textContent = plural(list.length, 'transaction');
  $('more').hidden = list.length <= st.LIM;
}

function donut(cur) {
  const inc = cur.incomeC, exp = cur.expenseC, net = inc - exp;
  const names = Object.keys(cur.catsC).sort((a, b) => cur.catsC[b] - cur.catsC[a]);
  const segs = [];
  let other = 0;
  if (net > 0) segs.push({ n: 'Kept', v: net, c: 'kept' });
  names.forEach((n, i) => { if (i < 4) segs.push({ n, v: cur.catsC[n], c: 'c' + i }); else other += cur.catsC[n]; });
  if (other > 0) segs.push({ n: 'Other spending', v: other, c: 'c4' });
  const base = Math.max(inc, exp);
  let cum = 0, arcs = '', key = '';
  for (const s of segs) {
    const len = base ? (s.v / base) * 100 : 0;
    const dash = segs.length > 1 ? Math.max(len - 0.5, 0) : len;
    arcs += '<circle class="arc ' + s.c + '" cx="21" cy="21" r="15.9155" stroke-dasharray="' + dash.toFixed(3) + ' ' + (100 - dash).toFixed(3) + '" stroke-dashoffset="' + (125 - cum).toFixed(3) + '"></circle>';
    cum += len;
    key += '<li><i class="dot ' + s.c + '"></i><span>' + esc(s.n) + '</span><span class="amt">' + money(s.v) + '</span></li>';
  }
  $('arcs').innerHTML = arcs;
  $('key').innerHTML = key;
  const p = $('dPct'), l = $('dLbl');
  if (!inc && !exp) { p.textContent = '–'; l.textContent = 'no activity'; }
  else if (!inc) { p.textContent = '0%'; l.textContent = 'of income kept'; }
  else if (net < 0) { p.textContent = 'Over'; l.textContent = 'spent more than income'; }
  else { p.textContent = Math.round((net / inc) * 100) + '%'; l.textContent = 'of income kept'; }
  $('donut').setAttribute('aria-label', inc || exp ? 'Income ' + money(inc) + ', expenses ' + money(exp) + '.' : 'No income or expenses in this period.');
}

/* ---------- Pages and controls ---------- */
const TITLES = { overview: 'Overview', transactions: 'Transactions', accounts: 'Accounts' };
function setView(v, keepScroll) {
  if (!TITLES[v]) v = 'overview';
  for (const n of Object.keys(TITLES)) $('v-' + n).hidden = n !== v;
  document.querySelectorAll('.nav a').forEach((a) => { if (a.dataset.v === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  $('title').textContent = TITLES[v];
  $('periodbar').hidden = v === 'accounts';
  $('range').hidden = v === 'accounts';
  try { history.replaceState(null, '', '#' + v); } catch (e) { /* not available here */ }
  if (!keepScroll) window.scrollTo(0, 0);
}
document.addEventListener('click', (ev) => {
  const a = ev.target.closest && ev.target.closest('[data-v]');
  if (a) { ev.preventDefault(); setView(a.dataset.v); }
});
const setPressed = (sel, attr, val) => document.querySelectorAll(sel).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === val)));
document.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => { st.P = b.dataset.p; st.OFF = 0; st.LIM = 50; setPressed('[data-p]', 'p', st.P); render(); }; });
document.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => { st.FLT = b.dataset.f; st.LIM = 50; setPressed('[data-f]', 'f', st.FLT); render(); }; });
$('prev').onclick = () => { st.OFF--; st.LIM = 50; render(); };
$('next').onclick = () => { if (st.OFF < 0) { st.OFF++; st.LIM = 50; render(); } };
// Correct how one transaction is counted. Real bank transactions are saved to the account; sample and imported ones stay in this tab.
$('tbody').addEventListener('change', (ev) => {
  const sel = ev.target.closest && ev.target.closest('select.kind');
  if (!sel) return;
  const x = st.DATA.find((t) => t.id === sel.dataset.id);
  if (!x) return;
  const before = x.kind;
  const auto = autoKind(x);
  x.kind = sel.value === auto ? undefined : sel.value;
  const focusId = x.id;
  render();
  const again = Array.from(document.querySelectorAll('select.kind')).find((e) => e.dataset.id === focusId && e.offsetParent !== null);
  if (again) again.focus();
  if (st.mode === 'user' && x.src === 'bank') {
    api('/api/classify', { id: x.id, kind: x.kind || null }).catch((e) => {
      x.kind = before; render();
      say('Could not save that change: ' + e.message);
    });
  }
});
$('q').oninput = function () { st.Q = this.value; st.LIM = 50; render(); };
$('more').onclick = () => { st.LIM += 50; render(); };

/* ---------- CSV import: read, preview, then choose replace or merge ---------- */
let impSeq = 0;
const imp = { text: '', name: '', opts: { spendingPositive: false, dateOrder: '', decimal: '' }, mode: 'merge', res: null };
const hasRealData = () => st.DATA.length > 0 && st.source !== 'sample';

$('csvBtn').onclick = () => $('csv').click();
$('sampleCsv').onclick = () => {
  const blob = new Blob([F.sampleCsv(F.todayKey())], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'sumveri-sample.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  say('Downloaded sumveri-sample.csv. Choose Import CSV to load it. It has one row with a bad date on purpose, so you can see how skipped rows are reported.');
};
$('csv').onchange = (ev) => {
  const f = ev.target.files[0];
  ev.target.value = '';
  if (!f) return;
  if (f.size > 5 * 1024 * 1024) { say('That file is larger than 5 MB. Split it into smaller files and import them one at a time.'); return; }
  const rd = new FileReader();
  rd.onerror = () => say('Could not read that file.');
  rd.onload = () => {
    imp.text = String(rd.result); imp.name = f.name; imp.prefix = 'csv' + (++impSeq) + '-' + Date.now().toString(36);
    imp.opts = { spendingPositive: false, dateOrder: '', decimal: '' };
    imp.mode = 'merge';
    renderImport();
    const dlg = $('importDlg');
    if (!dlg.open) dlg.showModal();
  };
  rd.readAsText(f);
};

function renderImport() {
  const focusId = document.activeElement && document.activeElement.id;
  const res = (imp.res = F.parseCsv(imp.text, { spendingPositive: imp.opts.spendingPositive, dateOrder: imp.opts.dateOrder || undefined, decimal: imp.opts.decimal || undefined, idPrefix: imp.prefix }));
  $('impFile').textContent = imp.name;
  const body = $('impBody'), go = $('impGo');
  if (res.fileError) {
    body.innerHTML = '<p class="form-err" role="alert">' + esc(res.fileError) + '</p><p class="small-note">Nothing was imported. Fix the file and try again.</p>';
    go.disabled = true; go.textContent = 'Import';
    return;
  }
  const n = res.rows.length, skipped = res.errors.length;
  let h = '<p class="imp-sum"><b>' + n.toLocaleString('en-US') + '</b> of ' + res.total.toLocaleString('en-US') + ' rows can be imported' +
    (skipped ? ', and <b>' + skipped.toLocaleString('en-US') + '</b> will be skipped' : '') + '.' +
    (n ? ' Dates run from ' + F.formatDay(res.minDate) + ', ' + res.minDate.slice(0, 4) + ' to ' + F.formatDay(res.maxDate) + ', ' + res.maxDate.slice(0, 4) + '.' : '') + '</p>';
  if (n) {
    h += '<dl class="imp-stats"><div><dt>Income</dt><dd class="in">' + money(res.stats.incomeC) + '</dd><small>' + plural(res.stats.incomeN, 'row') + '</small></div>' +
      '<div><dt>Expenses</dt><dd class="out">' + money(res.stats.expenseC) + '</dd><small>' + plural(res.stats.expenseN, 'row') + '</small></div>' +
      '<div><dt>Transfers</dt><dd>' + money(res.stats.transferC) + '</dd><small>' + plural(res.stats.transferN, 'row') + ', not counted</small></div></dl>';
  }
  const dec = res.decimal;
  h += '<div class="imp-set"><label for="impDec">Number format</label><select id="impDec">' +
    '<option value="point"' + (dec === 'point' ? ' selected' : '') + '>Decimal point: 1,234.56</option>' +
    '<option value="comma"' + (dec === 'comma' ? ' selected' : '') + '>Decimal comma: 1.234,56</option></select>' +
    '<label for="impSign">Amounts</label><select id="impSign">' +
    '<option value="neg"' + (imp.opts.spendingPositive ? '' : ' selected') + '>Spending is negative (most bank files)</option>' +
    '<option value="pos"' + (imp.opts.spendingPositive ? ' selected' : '') + '>Spending is positive (many credit card files)</option></select>';
  if (res.dateOrderGuessed || res.mixedDates || imp.opts.dateOrder) {
    h += '<label for="impOrder">Dates like 04/05/2026</label><select id="impOrder">' +
      '<option value=""' + (imp.opts.dateOrder ? '' : ' selected') + '>Automatic</option>' +
      '<option value="mdy"' + (imp.opts.dateOrder === 'mdy' ? ' selected' : '') + '>Month first (April 5)</option>' +
      '<option value="dmy"' + (imp.opts.dateOrder === 'dmy' ? ' selected' : '') + '>Day first (May 4)</option></select>';
  }
  h += '</div>';
  if (n) {
    const ex = res.rows.find((t) => t.raw && /\d[.,]\d/.test(t.raw)) || res.rows[0];
    h += '<p class="imp-ex">In your file, <b>' + esc(ex.raw) + '</b> becomes <b>' + signed(ex.cents) + '</b>. Check this against the amounts in the preview before importing.</p>';
  }
  if (res.decimalGuessed && !imp.opts.decimal) h += '<p class="small-note">The number format was chosen from the amounts in your file (' + (dec === 'comma' ? 'they use a decimal comma' : 'they use a decimal point') + '). Change it above if that is wrong.</p>';
  if (res.decimalConflict) h += '<p class="warn">This file mixes decimal points and decimal commas. Only rows matching the chosen format are imported; the rest are listed below as skipped.</p>';
  if (res.decimalUnclear) h += '<p class="warn">Some amounts such as 1,234 could mean 1,234.00 or 1.234. They were read with a decimal point. Switch the format above if your file uses decimal commas, and check the preview.</p>';
  if (res.allPositive && !imp.opts.spendingPositive) h += '<p class="warn">Every amount in this file is positive, so all of it will count as income. If the file lists spending as positive numbers, choose “Spending is positive” above.</p>';
  if (res.dateOrderGuessed) h += '<p class="warn">Some dates could be read either way. They were read as month first (04/05/2026 is April 5). Change this above if your file uses day first.</p>';
  if (res.mixedDates) h += '<p class="warn">This file mixes day-first and month-first dates. Rows that don’t fit the chosen order are skipped and listed below.</p>';
  if (res.stats.transferN) h += '<p class="small-note">' + (res.stats.transferN === 1 ? '1 row mentions' : res.stats.transferN + ' rows mention') + ' “transfer” in the description or category. ' + (res.stats.transferN === 1 ? 'It' : 'They') + ' will be listed but not counted as income or expenses until you change them. You can correct any row after importing, using “Counts as”.</p>';
  if (skipped) {
    h += '<details class="imp-err" open><summary>' + plural(skipped, 'row') + ' will be skipped</summary><ul>' +
      res.errors.slice(0, 20).map((e) => '<li>Row ' + e.row + ': ' + esc(e.message) + '</li>').join('') +
      (skipped > 20 ? '<li>and ' + (skipped - 20).toLocaleString('en-US') + ' more</li>' : '') + '</ul></details>';
  }
  if (n) {
    h += '<div class="tbl-wrap imp-prev"><table class="tbl"><thead><tr><th scope="col">Date</th><th scope="col">Description</th><th scope="col" class="r">In file</th><th scope="col" class="r">Amount</th></tr></thead><tbody>' +
      res.rows.slice(0, 6).map((x) => '<tr><td class="dt">' + F.formatDay(x.date) + '</td><td>' + esc(x.desc) + rowTags(x) + '</td><td class="r raw">' + esc(x.raw || '') + '</td><td class="r">' + amountHtml(x) + '</td></tr>').join('') +
      '</tbody></table></div>' + (n > 6 ? '<p class="small-note">Showing the first 6 of ' + n.toLocaleString('en-US') + '.</p>' : '');
  }
  if (hasRealData()) {
    h += '<fieldset class="imp-mode"><legend>What should happen to the transactions already shown?</legend>' +
      '<label><input type="radio" name="impMode" value="merge"' + (imp.mode === 'merge' ? ' checked' : '') + '> <span><b>Add to them</b> and skip duplicates (same date, amount and description)</span></label>' +
      '<label><input type="radio" name="impMode" value="replace"' + (imp.mode === 'replace' ? ' checked' : '') + '> <span><b>Replace them</b> with this file</span></label></fieldset>';
  } else {
    h += '<p class="small-note">' + (st.source === 'sample' ? 'This replaces the sample data in this tab.' : 'These transactions will be shown in this tab.') + '</p>';
  }
  h += '<p class="small-note">The file is read in your browser. Nothing is uploaded, and imported transactions are not saved. Reloading the page clears them.</p>';
  body.innerHTML = h;
  go.disabled = n === 0;
  go.textContent = n ? 'Import ' + plural(n, 'transaction') : 'Nothing to import';

  $('impDec').onchange = (e) => { imp.opts.decimal = e.target.value; renderImport(); };
  $('impSign').onchange = (e) => { imp.opts.spendingPositive = e.target.value === 'pos'; renderImport(); };
  const ord = $('impOrder');
  if (ord) ord.onchange = (e) => { imp.opts.dateOrder = e.target.value; renderImport(); };
  body.querySelectorAll('input[name="impMode"]').forEach((r) => { r.onchange = () => { imp.mode = r.value; }; });
  if (focusId && $(focusId)) $(focusId).focus();
}

function offsetContaining(date) {
  const today = F.todayKey();
  for (let o = 0; o > -1500; o--) {
    const r = F.range(st.P, o, today);
    if (date >= r.start && date < r.end) return o;
    if (r.end <= date) break;
  }
  return 0;
}

$('impCancel').onclick = () => $('importDlg').close();
$('impGo').onclick = () => {
  const res = imp.res;
  if (!res || res.fileError || !res.rows.length) return;
  const replacing = !hasRealData() || imp.mode === 'replace';
  let msg;
  if (replacing) {
    st.DATA = res.rows.slice();
    msg = 'Imported ' + plural(res.rows.length, 'transaction') + ' from ' + imp.name + (res.errors.length ? ' (' + plural(res.errors.length, 'row') + ' skipped)' : '') + '.';
  } else {
    const m = F.mergeTransactions(st.DATA, res.rows);
    st.DATA = m.merged;
    msg = 'Added ' + plural(m.added, 'transaction') + ' from ' + imp.name + (m.duplicates ? ', skipped ' + plural(m.duplicates, 'duplicate') : '') + (res.errors.length ? ' and ' + plural(res.errors.length, 'unreadable row') : '') + '.';
  }
  st.source = 'csv';
  const latest = res.maxDate > F.todayKey() ? F.todayKey() : res.maxDate;
  st.OFF = offsetContaining(latest);
  st.LIM = 50;
  $('importDlg').close();
  say(msg + ' Showing ' + F.label(st.P, F.range(st.P, st.OFF, F.todayKey())) + ', the latest period in the file. Imported transactions are kept in this tab only.');
  render();
};

/* ---------- Server calls ---------- */
function api(path, body) {
  const o = { method: body !== undefined ? 'POST' : 'GET' };
  if (body !== undefined) { o.headers = { 'Content-Type': 'application/json' }; o.body = JSON.stringify(body); }
  return fetch(path, o).then((r) => r.json().catch(() => ({})).then((j) => {
    if (r.status === 401 && st.mode === 'user' && !/^\/api\/(me|login|signup)/.test(path)) { showAuth('Your session ended. Sign in again.'); throw new Error('Please sign in.'); }
    if (!r.ok) throw new Error(j.error || 'Request failed');
    return j;
  }));
}

/* ---------- Sign in, demo and account menu ---------- */
let signupMode = false;
function setMode(s) {
  signupMode = s;
  $('authTitle').textContent = s ? 'Create your account' : 'Sign in';
  $('authSub').textContent = s ? 'Start tracking your money in a few minutes.' : 'Welcome back. Enter your details to continue.';
  $('nameField').hidden = !s; $('pwHint').hidden = !s;
  $('password').autocomplete = s ? 'new-password' : 'current-password';
  $('authSubmit').textContent = s ? 'Create account' : 'Sign in';
  const canSwitch = s || st.cfg.signup;
  $('switchBtn').hidden = !canSwitch;
  $('switchText').textContent = s ? 'Already have an account?' : st.cfg.signup ? 'New to Sumveri?' : 'New accounts are turned off on this server.';
  $('switchBtn').textContent = s ? 'Sign in' : 'Create an account';
  $('authErr').hidden = true;
}
$('switchBtn').onclick = () => setMode(!signupMode);
$('authForm').onsubmit = (ev) => {
  ev.preventDefault();
  const err = $('authErr'), b = $('authSubmit');
  err.hidden = true; b.disabled = true;
  const body = { email: $('email').value, password: $('password').value };
  if (signupMode) body.name = $('name').value;
  api(signupMode ? '/api/signup' : '/api/login', body)
    .then((j) => { $('password').value = ''; showApp(j.user); })
    .catch((e) => { err.textContent = e.message; err.hidden = false; })
    .then(() => { b.disabled = false; });
};
$('demoBtn').onclick = () => enterDemo('try');

function showAuth(message) {
  st.mode = 'auth';
  $('appRoot').hidden = true; $('auth').hidden = false;
  setMode(false);
  if (message) { $('authErr').textContent = message; $('authErr').hidden = false; }
}
function toggleMenu(open) { $('acctMenu').hidden = !open; $('avatar').setAttribute('aria-expanded', String(open)); }
$('avatar').onclick = (ev) => { ev.stopPropagation(); toggleMenu($('acctMenu').hidden); };
document.addEventListener('click', (ev) => { if (!$('acctMenu').hidden && !$('acctMenu').contains(ev.target)) toggleMenu(false); });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('acctMenu').hidden) { toggleMenu(false); $('avatar').focus(); } });
$('signout').onclick = () => {
  if (st.mode === 'demo') { showAuth(); return; }
  api('/api/logout', {}).catch(() => {}).then(() => location.reload());
};
$('demoExit').onclick = () => showAuth();
$('demoReset').onclick = () => {
  if (st.mode !== 'demo') return;
  st.DATA = F.sample(F.todayKey()); st.source = 'sample';
  st.P = 'month'; st.OFF = 0; st.FLT = 'all'; st.Q = ''; st.LIM = 50;
  setPressed('[data-p]', 'p', 'month'); setPressed('[data-f]', 'f', 'all'); $('q').value = '';
  say('Demo reset. The original sample data is back, and any changes or imports are gone.');
  render();
};

// Shared by the demo and real accounts
function openShell(name, email) {
  $('acctName').textContent = name; $('acctEmail').textContent = email;
  $('avatar').textContent = name.charAt(0).toUpperCase();
  $('auth').hidden = true; $('appRoot').hidden = false;
  toggleMenu(false); clearNotice();
  st.P = 'month'; st.OFF = 0; st.FLT = 'all'; st.Q = ''; st.LIM = 50;
  setPressed('[data-p]', 'p', 'month'); setPressed('[data-f]', 'f', 'all'); $('q').value = '';
  setView((location.hash || '').slice(1), true);
}

/* Demo: sample data in this browser tab. It never touches a server account, a session or a bank. */
function enterDemo(kind) {
  st.mode = 'demo'; st.demoKind = kind;
  st.DATA = F.sample(F.todayKey()); st.source = 'sample';
  openShell('Demo visitor', 'Sample data only');
  const text = {
    try: 'Demo mode. Everything here is sample data, not a real account.',
    public: 'Public demo. Everything here is sample data. Accounts and bank connections are turned off.',
    static: 'Demo. Everything here is sample data. Accounts and bank connections need the Sumveri server.',
  }[kind];
  $('demoText').textContent = text;
  $('demoBar').hidden = false;
  $('demoExit').hidden = kind !== 'try';
  $('demoReset').hidden = false;
  $('sampleCsv').hidden = false;
  $('demoExit').textContent = 'Sign in or create an account';
  $('signout').hidden = kind !== 'try';
  $('signout').textContent = 'Exit demo';
  const c = $('env'); c.textContent = 'Demo'; c.className = 'chip demo';
  renderBanks([], '');
  render();
}

function showApp(user) {
  st.mode = 'user'; st.demoKind = '';
  st.DATA = []; st.source = 'none';
  openShell(user.name || user.email.split('@')[0], user.email);
  $('demoBar').hidden = true;
  $('sampleCsv').hidden = true;
  $('signout').hidden = false; $('signout').textContent = 'Sign out';
  renderBanks([], '');
  sayHtml('No bank connected yet. <a href="#accounts" data-v="accounts">Connect a bank</a> or <a href="#transactions" data-v="transactions">import a CSV</a> to see your numbers.');
  render();
  loadStatus();
}

/* ---------- Banks ---------- */
const BANK_ICON = '<span class="bi"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/></svg></span>';
function renderBanks(banks, env) {
  const demo = st.mode === 'demo';
  const list = demo ? ['Sample Bank'] : banks;
  $('banks').innerHTML = list.map((b) => '<li>' + BANK_ICON + '<div><b>' + esc(b) + '</b><small>' + (demo ? 'Sample data' : 'Transactions, read-only') + '</small></div><span class="ok' + (demo ? ' demo' : '') + '">' + (demo ? 'Demo' : 'Connected') + '</span></li>').join('');
  $('bankHint').textContent = demo
    ? (st.demoKind === 'try' ? 'Bank connections are turned off in the demo. Create an account to connect your own bank.' : 'Bank connections are turned off here.')
    : banks.length ? '' : 'No bank connected yet. Connect one to see your real income and spending.';
  document.querySelectorAll('.js-disconnect').forEach((b) => { b.hidden = demo || !banks.length; });
  document.querySelectorAll('.js-connect').forEach((b) => {
    b.hidden = demo;
    b.textContent = banks.length ? 'Link another bank' : env === 'sandbox' ? 'Connect test bank' : 'Connect bank';
  });
}

function loadPlaid() {
  return new Promise((resolve, reject) => {
    if (window.Plaid) return resolve();
    const s = document.createElement('script');
    s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load Plaid. Check your connection and try again.'));
    document.head.appendChild(s);
  });
}

function loadReal() {
  say('Loading your transactions. The first load can take a few seconds.');
  return api('/api/transactions').then((j) => {
    st.DATA = j.transactions.map(F.fromServer).filter(Boolean);
    st.source = 'bank'; st.OFF = 0; st.LIM = 50;
    return api('/api/status').then((s) => {
      renderBanks(s.banks, s.env);
      say(st.DATA.length ? 'Showing ' + plural(st.DATA.length, 'transaction') + ' from your connected bank.' : 'Connected. No transactions yet. New ones can take a minute to appear.');
      render();
    });
  });
}

function openLink() {
  const btns = document.querySelectorAll('.js-connect');
  btns.forEach((b) => { b.disabled = true; });
  const done = () => btns.forEach((b) => { b.disabled = false; });
  Promise.all([loadPlaid(), api('/api/create_link_token', {})]).then(([, j]) => {
    window.Plaid.create({
      token: j.link_token,
      onSuccess: (pub, meta) => {
        say('Finishing the connection.');
        api('/api/exchange_public_token', { public_token: pub, institution: meta && meta.institution && meta.institution.name })
          .then(loadReal).then(done).catch((e) => { done(); say('Could not finish connecting: ' + e.message); });
      },
      onExit: (err) => { done(); if (err) say('Bank connection stopped: ' + (err.display_message || err.error_message || 'try again.')); },
    }).open();
  }).catch((e) => { done(); say('Could not start the connection: ' + e.message); });
}
document.querySelectorAll('.js-connect').forEach((b) => { b.onclick = openLink; });
document.querySelectorAll('.js-disconnect').forEach((b) => {
  b.onclick = () => {
    if (!window.confirm('Disconnect your banks and delete the saved transactions?')) return;
    api('/api/disconnect', {}).then(() => {
      st.DATA = []; st.source = 'none'; renderBanks([], st.cfg.env);
      say('Disconnected. Your saved bank data was deleted.'); render();
    }).catch((e) => say('Could not disconnect: ' + e.message));
  };
});
function loadStatus() {
  api('/api/status').then((s) => {
    st.cfg.env = s.env;
    const c = $('env'); c.textContent = s.env === 'sandbox' ? 'Test mode' : 'Live'; c.className = 'chip ' + (s.env === 'sandbox' ? 'test' : 'live');
    renderBanks(s.banks, s.env);
    if (s.connected) return loadReal();
  }).catch((e) => { if (e.message !== 'Please sign in.') { $('env').textContent = 'Offline'; say('Could not reach the Sumveri server. Is it running?'); } });
}

/* ---------- Start ---------- */
// No server (for example the page is on static hosting): the demo still works.
fetch('/api/config').then((r) => { if (!r.ok) throw new Error('no server'); return r.json(); })
  .then((cfg) => {
    if (typeof cfg.demoOnly !== 'boolean') throw new Error('no server');
    st.cfg = cfg;
    if (cfg.demoOnly) return enterDemo('public');
    return api('/api/me').then((j) => showApp(j.user)).catch(() => showAuth());
  })
  .catch(() => enterDemo('static'));
})();
