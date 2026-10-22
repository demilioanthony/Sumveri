/* Sumveri finance logic.
 * Pure functions with no page or server dependencies, so the browser, the server and the tests all use the same code.
 *
 * Conventions
 *  - Dates are 'YYYY-MM-DD' strings. They are never turned into Date objects from text, so a time zone can't shift them.
 *  - Money is whole cents (integers). Positive means money in, negative means money out.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Finance = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const SHORT = MONTHS.map((m) => m.slice(0, 3));
  const MAX_ROWS = 50000;

  // ---------- Dates ----------
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  const key = (y, m, d) => y + '-' + pad(m) + '-' + pad(d); // m is 1-12
  const splitKey = (k) => k.split('-').map(Number);
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const validYMD = (y, m, d) => y >= 1970 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
  const isDateKey = (s) => {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const p = splitKey(s);
    return validYMD(p[0], p[1], p[2]);
  };

  function addDays(k, n) {
    const p = splitKey(k);
    const t = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return key(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  function weekday(k) { // 0 = Sunday
    const p = splitKey(k);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
  }
  // The viewer's own calendar date.
  function todayKey(now) {
    const d = now || new Date();
    return key(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  // A period is [start, end): start is included, end is not. Weeks run Monday to Sunday.
  function range(period, offset, today) {
    const p = splitKey(today);
    let start, end;
    if (period === 'week') {
      const back = (weekday(today) + 6) % 7;
      start = addDays(today, -back + offset * 7);
      end = addDays(start, 7);
    } else if (period === 'month') {
      const idx = p[0] * 12 + (p[1] - 1) + offset;
      const at = (i) => [Math.floor(i / 12), ((i % 12) + 12) % 12 + 1];
      const a = at(idx), b = at(idx + 1);
      start = key(a[0], a[1], 1);
      end = key(b[0], b[1], 1);
    } else if (period === 'year') {
      start = key(p[0] + offset, 1, 1);
      end = key(p[0] + offset + 1, 1, 1);
    } else {
      throw new Error('Unknown period: ' + period);
    }
    return { start, end };
  }
  /* The range to compare against. For a period still in progress, the earlier period is cut to the same number of
   * days (October 1-21 against September 1-21). A finished period is compared with the whole earlier period. */
  function comparison(period, offset, today) {
    const cur = range(period, offset, today);
    const full = range(period, offset - 1, today);
    if (offset < 0) return { cur, prev: full, partial: false, label: 'prior ' + period };
    let elapsed = 0;
    for (let d = cur.start; d <= today; d = addDays(d, 1)) elapsed++;
    let end = addDays(full.start, elapsed);
    if (end > full.end) end = full.end;
    const partial = end < full.end;
    const prev = { start: full.start, end };
    return { cur, prev, partial, label: partial ? spanLabel(prev) : 'prior ' + period };
  }
  // "Sep 1-21", or "Sep 1 to Oct 3" across months
  function spanLabel(r) {
    const a = splitKey(r.start), b = splitKey(addDays(r.end, -1));
    if (r.start === addDays(r.end, -1)) return SHORT[a[1] - 1] + ' ' + a[2];
    if (a[1] === b[1] && a[0] === b[0]) return SHORT[a[1] - 1] + ' ' + a[2] + '-' + b[2];
    return SHORT[a[1] - 1] + ' ' + a[2] + ' to ' + SHORT[b[1] - 1] + ' ' + b[2];
  }
  function label(period, r) {
    const s = splitKey(r.start);
    if (period === 'year') return '' + s[0];
    if (period === 'month') return MONTHS[s[1] - 1] + ' ' + s[0];
    const l = splitKey(addDays(r.end, -1));
    return SHORT[s[1] - 1] + ' ' + s[2] + ' to ' + SHORT[l[1] - 1] + ' ' + l[2] + ', ' + l[0];
  }
  function formatDay(k) {
    const p = splitKey(k);
    return SHORT[p[1] - 1] + ' ' + p[2];
  }

  // ---------- Money ----------
  const toCents = (n) => Math.round(Number(n) * 100);

  // Money moving between your own accounts is not income or spending. Plaid labels these TRANSFER_IN / TRANSFER_OUT.
  // A credit card payment is only a transfer when the card itself is linked: then the card's purchases are the spending.
  function isTransferCategory(primary, detailed, cardLinked) {
    if (primary === 'TRANSFER_IN' || primary === 'TRANSFER_OUT') return true;
    return !!cardLinked && detailed === 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT';
  }
  const KINDS = ['income', 'expense', 'transfer'];
  // t.kind is a correction made by the person. It beats the automatic guess in t.transfer.
  function kindOf(t) {
    if (KINDS.includes(t.kind)) return t.kind;
    if (t.transfer) return 'transfer';
    return t.cents > 0 ? 'income' : 'expense';
  }

  // The category to show. It follows the person's correction: a transfer that was corrected to income is no longer
  // labeled "Transfer", and anything corrected to a transfer is labeled one.
  function displayCategory(t) {
    const k = kindOf(t);
    if (k === 'transfer') return 'Transfer';
    if (t.cat === 'Transfer') return k === 'income' ? 'Income' : 'Other';
    return t.cat;
  }

  // Turns a transaction from the server into the shape the page uses. Rows that can't be read are dropped.
  function fromServer(raw) {
    if (!raw || !isDateKey(raw.date) || !Number.isFinite(Number(raw.amt))) return null;
    return {
      id: String(raw.id), date: raw.date, desc: String(raw.desc || 'Transaction'), cat: String(raw.cat || 'Other'),
      cents: toCents(raw.amt), pending: !!raw.pending, transfer: !!raw.transfer, src: 'bank',
      kind: KINDS.includes(raw.kind) ? raw.kind : undefined,
    };
  }

  /* Totals for one period.
   *  income    money in that is not a transfer (refunds count here)
   *  expenses  money out that is not a transfer
   *  transfers shown separately, never added to income or expenses
   *  pending   not counted until the bank posts it, because the amount can still change
   * All values are cents. */
  function summarize(txs, r) {
    const out = {
      incomeC: 0, expenseC: 0, netC: 0, transferInC: 0, transferOutC: 0,
      pendingCount: 0, pendingInC: 0, pendingOutC: 0,
      counts: { income: 0, expense: 0, transfer: 0 }, catsC: {}, rows: [],
    };
    for (const t of txs) {
      if (t.date < r.start || t.date >= r.end) continue;
      out.rows.push(t);
      if (t.pending) {
        out.pendingCount++;
        if (t.cents > 0) out.pendingInC += t.cents; else out.pendingOutC -= t.cents;
        continue;
      }
      const k = kindOf(t);
      if (k === 'transfer') {
        out.counts.transfer++;
        if (t.cents > 0) out.transferInC += t.cents; else out.transferOutC -= t.cents;
      } else if (k === 'income') {
        out.counts.income++;
        out.incomeC += Math.abs(t.cents);
      } else {
        out.counts.expense++;
        out.expenseC += Math.abs(t.cents);
        const c = displayCategory(t);
        out.catsC[c] = (out.catsC[c] || 0) + Math.abs(t.cents);
      }
    }
    out.netC = out.incomeC - out.expenseC;
    return out;
  }

  // ---------- CSV import ----------
  function countOutsideQuotes(line, ch) {
    let q = false, n = 0;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') q = !q;
      else if (!q && line[i] === ch) n++;
    }
    return n;
  }
  function detectDelimiter(text) {
    const first = text.split(/\r\n|\n|\r/, 1)[0];
    let best = ',', bestN = 0;
    for (const d of [',', ';', '\t', '|']) {
      const n = countOutsideQuotes(first, d);
      if (n > bestN) { best = d; bestN = n; }
    }
    return best;
  }
  // Reads the whole text as records, so a quoted value can hold commas and line breaks.
  function parseRecords(text, delim) {
    const rows = [];
    let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; } else q = false;
        } else cur += ch;
      } else if (ch === '"' && cur === '') q = true;
      else if (ch === delim) { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = ''; rows.push(row); row = [];
      } else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return { rows, unterminated: q };
  }

  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const monthFromName = (s) => MON[String(s).slice(0, 3).toLowerCase()] || 0;
  const fullYear = (t) => (t.length === 2 ? 2000 + Number(t) : Number(t));

  // Reads the parts of a date exactly as written. A time or time zone after the date is ignored on purpose.
  function scanDate(raw) {
    const s = String(raw == null ? '' : raw).trim();
    let m;
    if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[T\s,].*)/.exec(s))) return { kind: 'ymd', y: +m[1], m: +m[2], d: +m[3] };
    if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:$|[T\s,].*)/.exec(s))) return { kind: 'num', a: +m[1], b: +m[2], y: fullYear(m[3]) };
    if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s))) return { kind: 'ymd', y: +m[3], m: monthFromName(m[1]), d: +m[2] };
    if ((m = /^(\d{1,2})[\s-]([A-Za-z]{3,9})\.?,?[\s-]+(\d{4}|\d{2})$/.exec(s))) return { kind: 'ymd', y: fullYear(m[3]), m: monthFromName(m[2]), d: +m[1] };
    return null;
  }
  function resolveDate(sc, order) {
    if (!sc) return null;
    let y, m, d;
    if (sc.kind === 'ymd') { y = sc.y; m = sc.m; d = sc.d; }
    else if (order === 'dmy') { d = sc.a; m = sc.b; y = sc.y; }
    else { m = sc.a; d = sc.b; y = sc.y; }
    return validYMD(y, m, d) ? key(y, m, d) : null;
  }
  function parseDate(raw, order) { return resolveDate(scanDate(raw), order || 'mdy'); }

  // Day-first or month-first? A value like 25/03/2026 settles it. If nothing does, month-first is assumed and the file is flagged.
  function detectDateOrder(scans) {
    let dayFirst = 0, monthFirst = 0, ambiguous = 0;
    for (const sc of scans) {
      if (!sc || sc.kind !== 'num') continue;
      if (sc.a > 12 && sc.b <= 12) dayFirst++;
      else if (sc.b > 12 && sc.a <= 12) monthFirst++;
      else if (sc.a <= 12 && sc.b <= 12 && sc.a !== sc.b) ambiguous++;
    }
    if (dayFirst && !monthFirst) return { order: 'dmy', guessed: false, mixed: false };
    if (monthFirst && !dayFirst) return { order: 'mdy', guessed: false, mixed: false };
    if (dayFirst && monthFirst) return { order: 'mdy', guessed: false, mixed: true };
    return { order: 'mdy', guessed: ambiguous > 0, mixed: false };
  }

  // Reads "$1,234.56", "(45.00)", "-45", "45-" or, with decimalComma, "1.234,56" and "12,50". Returns cents, or an error message.
  function parseAmount(raw, decimalComma) {
    let s = String(raw == null ? '' : raw).replace(/[\s ]/g, '');
    if (s === '') return { empty: true };
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[$€£¥]/g, '');
    if (s[0] === '-') { neg = true; s = s.slice(1); }
    else if (s[0] === '+') s = s.slice(1);
    if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
    // Each format accepts only its own shape. A value in the other format is rejected, never guessed at:
    // reading "12.50" with a decimal comma would give 1250.
    if (decimalComma) {
      if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
      else if (/^\d*(,\d+)?$/.test(s)) s = s.replace(',', '.');
      else if (/^\d+\.\d{1,2}$/.test(s) || /^\d{1,3}(,\d{3})+\.\d+$/.test(s)) return { error: 'uses a decimal point, but "Decimal comma" is selected' };
    } else {
      if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
      else if (/^\d+,\d{1,2}$/.test(s) || /^\d{1,3}(\.\d{3})+,\d+$/.test(s)) return { error: 'uses a decimal comma, but "Decimal point" is selected' };
    }
    const m = /^(\d*)(?:\.(\d+))?$/.exec(s);
    if (!m || (m[1] === '' && m[2] === undefined)) return { error: 'is not a number' };
    if (m[2] && m[2].length > 2) return { error: 'has more than two decimal places' };
    const cents = Number(m[1] || '0') * 100 + Number(((m[2] || '') + '00').slice(0, 2));
    if (!Number.isSafeInteger(cents) || cents > 1e12) return { error: 'is too large' };
    return { cents: neg ? -cents : cents };
  }

  // Which decimal format does the file use? Only clear evidence counts: "12,50" or "1.234,56" means comma,
  // "12.50" or "1,234.56" means point. Values such as "1,234" fit both, so they prove nothing.
  function detectDecimal(cells) {
    let comma = 0, point = 0, unclear = 0;
    for (const raw of cells) {
      const v = String(raw == null ? '' : raw).replace(/[\s ()$€£¥+-]/g, '');
      if (/^\d+,\d{1,2}$/.test(v) || /^\d{1,3}(\.\d{3})+,\d+$/.test(v)) comma++;
      else if (/^\d+\.\d{1,2}$/.test(v) || /^\d{1,3}(,\d{3})+\.\d+$/.test(v)) point++;
      else if (/^\d{1,3}([.,]\d{3})+$/.test(v)) unclear++;
    }
    return { comma, point, unclear };
  }

  const findCol = (header, tests) => {
    for (const t of tests) {
      const i = header.findIndex((h) => t.test(h));
      if (i > -1) return i;
    }
    return -1;
  };
  const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n) + '...' : String(s));

  /* Reads a bank CSV and reports exactly what it understood.
   * opts.spendingPositive  true when the file shows spending as positive numbers (many credit card exports)
   * opts.dateOrder         'mdy' or 'dmy' to override detection
   * opts.idPrefix          each imported row gets the id prefix-rowNumber. Give every import its own prefix, so ids stay unique
   *                        after two files are merged.
   * opts.decimal           'point' (1,234.56) or 'comma' (1.234,56). Never guessed from the delimiter. With no choice,
   *                        the file's own values decide when they are clear, and point is used otherwise.
   * Rows that can't be read are returned in `errors` with their row number (row 1 is the header). */
  function parseCsv(text, opts) {
    opts = opts || {};
    const idPrefix = opts.idPrefix || 'csv';
    const res = {
      fileError: null, rows: [], errors: [], total: 0, blank: 0, delimiter: ',',
      dateOrder: 'mdy', dateOrderGuessed: false, mixedDates: false, columns: {},
      decimal: 'point', decimalGuessed: false, decimalConflict: false, decimalUnclear: false,
      minDate: null, maxDate: null, allPositive: false,
      stats: { incomeC: 0, expenseC: 0, incomeN: 0, expenseN: 0, transferN: 0, transferC: 0 },
    };
    if (typeof text !== 'string' || !text.trim()) { res.fileError = 'The file is empty.'; return res; }
    text = text.replace(/^﻿/, '');
    const delim = detectDelimiter(text);
    res.delimiter = delim;
    const parsed = parseRecords(text, delim);
    if (parsed.unterminated) { res.fileError = 'The file ends inside a quoted value. A closing quote is missing.'; return res; }
    const all = parsed.rows;
    if (all.length - 1 > MAX_ROWS) { res.fileError = 'The file has more than ' + MAX_ROWS.toLocaleString('en-US') + ' rows. Split it into smaller files.'; return res; }

    const header = all[0].map((h) => h.trim().toLowerCase());
    const di = findCol(header, [/^date$/, /^transaction date$/, /^(posted|posting|post) date$/, /date/]);
    const ni = findCol(header, [/^description$/, /^name$/, /^payee$/, /^merchant$/, /^memo$/, /^details?$/, /desc|memo|payee|merchant|narrative/]);
    const ai = findCol(header, [/^amount$/, /^amount\b/, /amount/]);
    const debi = findCol(header, [/^(debit|withdrawals?|money out|paid out)$/, /debit|withdrawal/]);
    const credi = findCol(header, [/^(credit|deposits?|money in|paid in)$/, /credit|deposit/]);
    const ci = findCol(header, [/^category$/]);
    res.columns = { date: di, description: ni, amount: ai, debit: debi, credit: credi, category: ci };
    if (di < 0) { res.fileError = 'Could not find a Date column. The first row needs column names such as Date, Description and Amount.'; return res; }
    const split = ai < 0 && (debi > -1 || credi > -1);
    if (ai < 0 && !split) { res.fileError = 'Could not find an Amount column. The first row needs a column named Amount, or separate Debit and Credit columns.'; return res; }

    const body = all.slice(1);
    const scans = body.map((r) => scanDate(r[di]));
    const det = detectDateOrder(scans);
    const order = opts.dateOrder === 'dmy' || opts.dateOrder === 'mdy' ? opts.dateOrder : det.order;
    res.dateOrder = order;
    res.dateOrderGuessed = det.guessed && !opts.dateOrder;
    res.mixedDates = det.mixed;
    const amountCells = [];
    for (const r of body) {
      if (ai > -1) amountCells.push(r[ai]);
      if (debi > -1) amountCells.push(r[debi]);
      if (credi > -1) amountCells.push(r[credi]);
    }
    const dec = detectDecimal(amountCells);
    res.decimalConflict = dec.comma > 0 && dec.point > 0;
    res.decimalUnclear = dec.comma === 0 && dec.point === 0 && dec.unclear > 0;
    let decimal = opts.decimal;
    if (decimal !== 'point' && decimal !== 'comma') {
      decimal = dec.comma > 0 && dec.point === 0 ? 'comma' : 'point';
      res.decimalGuessed = dec.comma > 0 || dec.point > 0;
    }
    res.decimal = decimal;
    const decimalComma = decimal === 'comma';

    body.forEach((r, i) => {
      const rowNum = i + 2;
      if (r.every((c) => String(c).trim() === '')) { res.blank++; return; }
      res.total++;
      const bad = (msg) => res.errors.push({ row: rowNum, message: msg });
      const rawDate = (r[di] || '').trim();
      if (!rawDate) return bad('the date is empty');
      const date = resolveDate(scans[i], order);
      if (!date) return bad('could not read the date "' + clip(rawDate, 30) + '"');

      let cents;
      if (!split) {
        const a = parseAmount(r[ai], decimalComma);
        if (a.empty) return bad('the amount is empty');
        if (a.error) return bad('the amount "' + clip(r[ai], 30) + '" ' + a.error);
        cents = opts.spendingPositive ? -a.cents : a.cents;
      } else {
        const d = debi > -1 ? parseAmount(r[debi], decimalComma) : { empty: true };
        const c = credi > -1 ? parseAmount(r[credi], decimalComma) : { empty: true };
        if (d.error) return bad('the debit "' + clip(r[debi], 30) + '" ' + d.error);
        if (c.error) return bad('the credit "' + clip(r[credi], 30) + '" ' + c.error);
        if (d.empty && c.empty) return bad('both the debit and credit are empty');
        cents = Math.abs(c.cents || 0) - Math.abs(d.cents || 0);
      }
      if (cents === 0) return bad('the amount is 0.00');

      const desc = (ni > -1 ? String(r[ni] || '') : '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Transaction';
      const catRaw = ci > -1 ? String(r[ci] || '').trim().slice(0, 40) : '';
      const transfer = /\btransfer\b|\bxfer\b/i.test(desc) || /transfer/i.test(catRaw);
      const cat = transfer ? 'Transfer' : catRaw || (cents > 0 ? 'Income' : 'Imported');
      const rawAmount = !split ? String(r[ai]).trim() : [debi > -1 ? r[debi] : '', credi > -1 ? r[credi] : ''].map((x) => String(x || '').trim()).filter(Boolean).join(' / ');
      res.rows.push({ id: idPrefix + '-' + rowNum, date, desc, cat, cents, pending: false, transfer, src: 'csv', raw: rawAmount });

      if (!res.minDate || date < res.minDate) res.minDate = date;
      if (!res.maxDate || date > res.maxDate) res.maxDate = date;
      if (transfer) { res.stats.transferN++; res.stats.transferC += Math.abs(cents); }
      else if (cents > 0) { res.stats.incomeN++; res.stats.incomeC += cents; }
      else { res.stats.expenseN++; res.stats.expenseC -= cents; }
    });
    res.allPositive = !split && res.rows.length > 0 && res.rows.every((t) => t.cents > 0);
    return res;
  }

  // Two transactions match when date, amount and description match. Identical purchases on one day are kept
  // as separate rows, so importing the same file twice adds nothing the second time.
  const signature = (t) => t.date + '|' + t.cents + '|' + String(t.desc).toLowerCase().replace(/\s+/g, ' ').trim();
  function mergeTransactions(existing, incoming) {
    const have = new Map();
    for (const t of existing) { const s = signature(t); have.set(s, (have.get(s) || 0) + 1); }
    const seen = new Map();
    const add = [];
    let duplicates = 0;
    for (const t of incoming) {
      const s = signature(t);
      const n = (seen.get(s) || 0) + 1;
      seen.set(s, n);
      if (n <= (have.get(s) || 0)) duplicates++; else add.push(t);
    }
    // Whatever the source, ids must be unique: edits find a transaction by id.
    const used = new Set(existing.map((t) => t.id));
    const fixed = add.map((t) => {
      if (!used.has(t.id)) { used.add(t.id); return t; }
      let n = 2, id;
      do { id = t.id + '-' + n++; } while (used.has(id));
      used.add(id);
      return Object.assign({}, t, { id });
    });
    return { merged: existing.concat(fixed), added: fixed.length, duplicates };
  }

  // ---------- Sample data for the demo ----------
  function mulberry(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /* Sample data for the demo: about a year and a half of ordinary life, built to show every feature.
   *  - this month so far has positive cash flow, last month is negative (car repair, dental, flights)
   *  - transfers to and from savings, and a "wire transfer from client" that is automatically treated as a transfer
   *    but is really income (the Income / Expense / Transfer selector fixes it)
   *  - pending card activity from today and yesterday */
  function sample(today) {
    const r = mulberry(7);
    const out = [];
    const add = (date, desc, cat, amt, extra) => out.push(Object.assign(
      { id: 's' + out.length, date, desc, cat, cents: toCents(amt), pending: false, transfer: false, src: 'sample' }, extra || {}));
    const pick = (a) => a[Math.floor(r() * a.length)];
    const t = splitKey(today);
    const lastMonth = t[1] === 1 ? [t[0] - 1, 12] : [t[0], t[1] - 1];
    for (let d = key(t[0] - 1, 1, 1); d <= today; d = addDays(d, 1)) {
      const n = Number(d.slice(8, 10));
      const ym = d.slice(0, 7);
      const isLast = ym === key(lastMonth[0], lastMonth[1], 1).slice(0, 7);
      if (n === 1) add(d, 'Rent', 'Rent and utilities', -1350);
      if (n === 1 || n === 15) add(d, 'Paycheck', 'Income', 2450);
      if (n === 3) add(d, 'Transfer to savings', 'Transfer', -500, { transfer: true });
      if (n === 5) add(d, 'Electric and water', 'Rent and utilities', -(90 + r() * 50));
      if (n === 12) add(d, 'Streaming and music', 'Entertainment', -24.98);
      if (n === 22) add(d, 'Transfer from savings', 'Transfer', 150, { transfer: true });
      if (r() < 0.35) add(d, pick(['Publix', 'Aldi', 'Target Grocery']), 'Groceries', -(30 + r() * 90));
      if (r() < 0.25) add(d, pick(['Chipotle', 'Local Cafe', 'Pizza Night']), 'Food and drink', -(12 + r() * 48));
      if (r() < 0.2) add(d, pick(['Gas station', 'Parking', 'Rideshare']), 'Transport', -(8 + r() * 32));
      if (r() < 0.1) add(d, pick(['Online order', 'Hardware store', 'Pharmacy']), 'Shopping', -(20 + r() * 130));
      if (!isLast && r() < 0.03) add(d, 'Freelance payment', 'Income', 200 + r() * 700);
      if (isLast) {
        if (n === 9) add(d, 'Auto repair', 'Transport', -1850);
        if (n === 14) add(d, 'Dental office', 'Health', -420);
        if (n === 18) add(d, 'Airline tickets', 'Travel', -640);
      }
    }
    // A client payment that arrived by wire. The word "transfer" makes the app set it aside, so it starts as a transfer.
    add(addDays(key(t[0], t[1], 1), 1) > today ? today : addDays(key(t[0], t[1], 1), 1), 'Wire transfer from client', 'Transfer', 1200, { transfer: true });
    add(today, 'Corner Coffee', 'Food and drink', -6.5);
    add(addDays(today, -1), 'Pharmacy', 'Shopping', -18.4);
    for (const x of out) if (x.date >= addDays(today, -1) && x.date <= today && x.cents < 0 && x.desc !== 'Rent') x.pending = true;
    return out;
  }

  // A small CSV with dates around today, for trying the import: income, expenses, a transfer, a wire, a refund and a bad row.
  function sampleCsv(today) {
    const d = (n) => addDays(today, -n);
    const rows = [
      [d(9), 'Paycheck', '2450.00'], [d(8), 'Rent', '-1350.00'], [d(8), 'Transfer to savings', '-400.00'],
      [d(7), 'Wire transfer from client', '1200.00'], [d(6), 'Aldi', '-62.15'], [d(5), 'Chipotle', '-13.75'],
      [d(4), 'Electric company', '-104.20'], [d(3), 'Pharmacy refund', '12.50'], [d(2), 'Gas station', '-41.00'],
      [d(1), 'Online order', '-249.99'], ['yesterday', 'Row with a bad date', '-5.00'],
    ];
    return 'Date,Description,Amount\n' + rows.map((x) => x[0] + ',' + x[1] + ',' + x[2]).join('\n') + '\n';
  }

  return {
    MAX_ROWS, key, splitKey, addDays, weekday, todayKey, isDateKey, range, label, formatDay,
    KINDS, displayCategory, comparison, spanLabel, toCents, isTransferCategory, kindOf, fromServer, summarize, sampleCsv,
    parseDate, parseAmount, parseCsv, mergeTransactions, signature, sample,
  };
});
