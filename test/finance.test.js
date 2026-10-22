const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../public/finance.js');

const tx = (date, cents, extra) => Object.assign({ id: date + cents, date, desc: 'x', cat: 'Other', cents, pending: false, transfer: false }, extra || {});

test('weeks run Monday to Sunday, and the end date is not included', () => {
  assert.deepEqual(F.range('week', 0, '2026-10-21'), { start: '2026-10-19', end: '2026-10-26' }); // Wednesday
  assert.deepEqual(F.range('week', 0, '2026-10-19'), { start: '2026-10-19', end: '2026-10-26' }); // Monday
  assert.deepEqual(F.range('week', 0, '2026-10-25'), { start: '2026-10-19', end: '2026-10-26' }); // Sunday
  assert.deepEqual(F.range('week', 0, '2026-10-26'), { start: '2026-10-26', end: '2026-11-02' }); // next Monday
  assert.deepEqual(F.range('week', -1, '2026-10-21'), { start: '2026-10-12', end: '2026-10-19' });
});

test('a week can cross the new year', () => {
  assert.deepEqual(F.range('week', 0, '2027-01-01'), { start: '2026-12-28', end: '2027-01-04' });
});

test('months, including December, January and leap-year February', () => {
  assert.deepEqual(F.range('month', 0, '2026-10-21'), { start: '2026-10-01', end: '2026-11-01' });
  assert.deepEqual(F.range('month', 0, '2026-12-15'), { start: '2026-12-01', end: '2027-01-01' });
  assert.deepEqual(F.range('month', -1, '2026-01-10'), { start: '2025-12-01', end: '2026-01-01' });
  assert.deepEqual(F.range('month', 2, '2026-11-30'), { start: '2027-01-01', end: '2027-02-01' });
  assert.deepEqual(F.range('month', 0, '2028-02-10'), { start: '2028-02-01', end: '2028-03-01' });
  assert.equal(F.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(F.addDays('2027-02-28', 1), '2027-03-01');
});

test('years', () => {
  assert.deepEqual(F.range('year', 0, '2026-10-21'), { start: '2026-01-01', end: '2027-01-01' });
  assert.deepEqual(F.range('year', -1, '2026-10-21'), { start: '2025-01-01', end: '2026-01-01' });
});

test('period labels', () => {
  assert.equal(F.label('month', F.range('month', 0, '2026-10-21')), 'October 2026');
  assert.equal(F.label('week', F.range('week', 0, '2026-10-21')), 'Oct 19 to Oct 25, 2026');
  assert.equal(F.label('year', F.range('year', 0, '2026-10-21')), '2026');
  assert.throws(() => F.range('decade', 0, '2026-10-21'));
});

test('date keys are validated against the real calendar', () => {
  assert.ok(F.isDateKey('2028-02-29'));
  assert.ok(!F.isDateKey('2027-02-29'));
  assert.ok(!F.isDateKey('2026-13-01'));
  assert.ok(!F.isDateKey('2026-1-1'));
  assert.ok(!F.isDateKey(20261001));
});

test('first and last day of a month are counted, the day after is not', () => {
  const r = F.range('month', 0, '2026-10-21');
  const s = F.summarize([
    tx('2026-09-30', -1000), tx('2026-10-01', -200), tx('2026-10-31', -300), tx('2026-11-01', -4000),
  ], r);
  assert.equal(s.expenseC, 500);
  assert.equal(s.counts.expense, 2);
});

test('income, expenses and net cash flow, with transfers and pending kept out', () => {
  const r = F.range('month', 0, '2026-10-21');
  const s = F.summarize([
    tx('2026-10-15', 200000, { cat: 'Income' }),
    tx('2026-10-02', -4510, { cat: 'Groceries' }),
    tx('2026-10-03', -50000, { transfer: true, cat: 'Transfer' }),
    tx('2026-10-22', 15000, { transfer: true, cat: 'Transfer' }),
    tx('2026-10-20', -2000, { pending: true, cat: 'Dining' }),
    tx('2026-10-21', 9900, { pending: true }),
  ], r);
  assert.equal(s.incomeC, 200000);
  assert.equal(s.expenseC, 4510);
  assert.equal(s.netC, 195490);
  assert.equal(s.transferInC, 15000);
  assert.equal(s.transferOutC, 50000);
  assert.equal(s.pendingCount, 2);
  assert.equal(s.pendingOutC, 2000);
  assert.equal(s.pendingInC, 9900);
  assert.deepEqual(s.catsC, { Groceries: 4510 });
  assert.deepEqual(s.counts, { income: 1, expense: 1, transfer: 2 });
});

test('transfers never change income, expenses or net', () => {
  const r = F.range('month', 0, '2026-10-21');
  const base = [tx('2026-10-05', 100000), tx('2026-10-06', -30000)];
  const withTransfers = base.concat([tx('2026-10-07', -999999, { transfer: true }), tx('2026-10-08', 999999, { transfer: true })]);
  const a = F.summarize(base, r), b = F.summarize(withTransfers, r);
  assert.equal(a.incomeC, b.incomeC);
  assert.equal(a.expenseC, b.expenseC);
  assert.equal(a.netC, b.netC);
});

test('money is added as whole cents, so 0.1 + 0.2 is exactly 0.30', () => {
  const r = F.range('month', 0, '2026-10-21');
  const s = F.summarize([tx('2026-10-01', F.toCents(0.1)), tx('2026-10-02', F.toCents(0.2))], r);
  assert.equal(s.incomeC, 30);
  const many = [];
  for (let i = 0; i < 3; i++) many.push(tx('2026-10-0' + (i + 1), F.toCents(-0.1)));
  assert.equal(F.summarize(many, r).expenseC, 30);
  assert.equal(F.toCents(1.005), 100); // 1.005 is stored as 1.00499999...; whole-cent input is what matters
  assert.equal(F.toCents(19.99), 1999);
  assert.equal(F.toCents(-0.07), -7);
});

test('which bank categories count as transfers', () => {
  assert.ok(F.isTransferCategory('TRANSFER_IN', 'TRANSFER_IN_ACCOUNT_TRANSFER'));
  assert.ok(F.isTransferCategory('TRANSFER_OUT', 'TRANSFER_OUT_SAVINGS'));
  assert.ok(!F.isTransferCategory('INCOME', 'INCOME_WAGES'));
  assert.ok(!F.isTransferCategory('FOOD_AND_DRINK', 'FOOD_AND_DRINK_COFFEE'));
  // A card payment is spending unless the card itself is linked.
  assert.ok(!F.isTransferCategory('LOAN_PAYMENTS', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', false));
  assert.ok(F.isTransferCategory('LOAN_PAYMENTS', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', true));
  assert.ok(!F.isTransferCategory('LOAN_PAYMENTS', 'LOAN_PAYMENTS_MORTGAGE_PAYMENT', true));
});

test('server rows are converted, and unreadable rows are dropped', () => {
  const ok = F.fromServer({ id: 'a', date: '2026-10-05', desc: 'Aldi', cat: 'Shopping', amt: -43.3, pending: 1, transfer: false });
  assert.equal(ok.cents, -4330);
  assert.equal(ok.pending, true);
  assert.equal(ok.src, 'bank');
  assert.equal(F.fromServer({ id: 'b', date: 'not a date', amt: 1 }), null);
  assert.equal(F.fromServer({ id: 'c', date: '2026-10-05', amt: 'abc' }), null);
  assert.equal(F.fromServer(null), null);
});

test('the sample data shows transfers and a pending item, and none of it is in the future', () => {
  const today = '2026-10-21';
  const data = F.sample(today);
  assert.ok(data.every((t) => t.date <= today));
  assert.ok(data.some((t) => t.pending));
  assert.ok(data.every((t) => !t.pending || t.date >= F.addDays(today, -1)));
  const sept = F.summarize(data, F.range('month', -1, today));
  assert.equal(sept.counts.transfer, 2);
  assert.equal(sept.transferOutC, 50000);
  assert.equal(sept.transferInC, 15000);
  assert.equal(sept.netC, sept.incomeC - sept.expenseC);
  assert.deepEqual(F.sample(today), F.sample(today), 'sample data is the same every time');
});

// ---------- correcting how a transaction is counted ----------
test('a manual Income / Expense / Transfer choice beats the automatic guess', () => {
  const r = { start: '2026-10-01', end: '2026-11-01' };
  const wire = tx('2026-10-05', 120000, { desc: 'Wire transfer from client', transfer: true });
  assert.equal(F.kindOf(wire), 'transfer', 'starts as a transfer because of the word');
  assert.equal(F.summarize([wire], r).incomeC, 0);

  const fixed = Object.assign({}, wire, { kind: 'income' });
  assert.equal(F.kindOf(fixed), 'income');
  const s = F.summarize([fixed], r);
  assert.equal(s.incomeC, 120000);
  assert.equal(s.netC, 120000);
  assert.equal(s.counts.transfer, 0);

  // and the other way: a real expense that was guessed as income, or something that is only a transfer
  const sav = Object.assign(tx('2026-10-06', -50000), { kind: 'transfer' });
  const s2 = F.summarize([sav], r);
  assert.equal(s2.expenseC, 0);
  assert.equal(s2.transferOutC, 50000);
  const asExpense = Object.assign(tx('2026-10-07', 2500), { kind: 'expense' });
  assert.equal(F.summarize([asExpense], r).expenseC, 2500);
  assert.equal(F.kindOf(Object.assign(tx('2026-10-07', 2500), { kind: 'nonsense' })), 'income', 'an unknown value is ignored');
});

// ---------- comparing with the same stretch of the prior period ----------
test('a period in progress is compared with the same days of the prior period', () => {
  let c = F.comparison('month', 0, '2026-10-21');
  assert.deepEqual(c.cur, { start: '2026-10-01', end: '2026-11-01' });
  assert.deepEqual(c.prev, { start: '2026-09-01', end: '2026-09-22' }, 'Sep 1 to 21, which is 21 days like Oct 1 to 21');
  assert.equal(c.label, 'Sep 1-21');
  assert.equal(c.partial, true);

  c = F.comparison('week', 0, '2026-10-21'); // Wednesday: Monday to Wednesday so far
  assert.deepEqual(c.prev, { start: '2026-10-12', end: '2026-10-15' });
  assert.equal(c.label, 'Oct 12-14');

  c = F.comparison('year', 0, '2026-10-21');
  assert.deepEqual(c.prev, { start: '2025-01-01', end: '2025-10-22' });
  assert.equal(c.label, 'Jan 1 to Oct 21');

  c = F.comparison('month', 0, '2026-10-01'); // first day: one day against one day
  assert.deepEqual(c.prev, { start: '2026-09-01', end: '2026-09-02' });
  assert.equal(c.label, 'Sep 1');
});

test('comparison edge cases: shorter prior month, last day of the period, leap years', () => {
  // March 31 against February: only 28 days exist, so the whole of February
  let c = F.comparison('month', 0, '2026-03-31');
  assert.deepEqual(c.prev, { start: '2026-02-01', end: '2026-03-01' });
  assert.equal(c.partial, false);
  assert.equal(c.label, 'prior month');
  // Leap-year February has 29 days: March 28 covers 28 of them, March 29 covers all of them
  c = F.comparison('month', 0, '2028-03-28');
  assert.deepEqual(c.prev, { start: '2028-02-01', end: '2028-02-29' });
  c = F.comparison('month', 0, '2028-03-29');
  assert.deepEqual(c.prev, { start: '2028-02-01', end: '2028-03-01' });
  assert.equal(c.partial, false);
  // Last day of a 30-day month against a 31-day month still stops at day 30
  c = F.comparison('month', 0, '2026-11-30');
  assert.deepEqual(c.prev, { start: '2026-10-01', end: '2026-10-31' });
  assert.equal(c.partial, true);
  // Sunday: the whole week against the whole prior week
  c = F.comparison('week', 0, '2026-10-25');
  assert.deepEqual(c.prev, { start: '2026-10-12', end: '2026-10-19' });
  assert.equal(c.label, 'prior week');
  // a leap day does not break year comparisons
  c = F.comparison('year', 0, '2028-12-31');
  assert.deepEqual(c.prev, { start: '2027-01-01', end: '2028-01-01' });
});

test('a finished period is compared with the whole prior period', () => {
  const c = F.comparison('month', -1, '2026-10-21');
  assert.deepEqual(c.cur, { start: '2026-09-01', end: '2026-10-01' });
  assert.deepEqual(c.prev, { start: '2026-08-01', end: '2026-09-01' });
  assert.equal(c.partial, false);
});

test('the totals for the same days are what the comparison reports', () => {
  const txs = [
    tx('2026-09-05', -1000), tx('2026-09-21', -2000), tx('2026-09-22', -99999), // after day 21: left out
    tx('2026-10-03', -1500),
  ];
  const c = F.comparison('month', 0, '2026-10-21');
  assert.equal(F.summarize(txs, c.prev).expenseC, 3000);
  assert.equal(F.summarize(txs, F.range('month', -1, '2026-10-21')).expenseC, 102999, 'the full month would have given a very different answer');
});

// ---------- the demo data ----------
test('demo data shows every feature, whatever day it is opened', () => {
  for (const today of ['2026-10-21', '2026-03-02', '2026-01-05', '2026-12-31', '2027-02-28', '2028-03-01']) {
    const s = F.sample(today);
    const month = F.summarize(s, F.range('month', 0, today));
    const last = F.summarize(s, F.range('month', -1, today));
    assert.ok(month.netC > 0, today + ': this month is positive');
    assert.ok(last.netC < 0, today + ': last month is negative');
    assert.ok(s.some((t) => t.pending), today + ': has pending');
    assert.ok(s.some((t) => t.transfer && t.cents < 0) && s.some((t) => t.transfer && t.cents > 0), today + ': transfers both ways');
    assert.ok(s.some((t) => t.desc === 'Wire transfer from client'), today + ': a wire that needs correcting');
    assert.ok(s.every((t) => F.isDateKey(t.date) && t.date <= today), today + ': all dates valid and not in the future');
    assert.equal(new Set(s.map((t) => t.id)).size, s.length, today + ': unique ids');
  }
});

test('the sample CSV imports cleanly except for one deliberately bad row', () => {
  const r = F.parseCsv(F.sampleCsv('2026-10-21'));
  assert.equal(r.rows.length, 10);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].row, 12);
  assert.ok(r.rows.some((t) => t.desc === 'Wire transfer from client' && t.transfer), 'the wire starts as a transfer');
  assert.ok(r.maxDate <= '2026-10-21');
});

// ---------- ids and labels after corrections ----------
test('two imported files never share transaction ids, so editing one row cannot change another', () => {
  const text = 'Date,Description,Amount\n2026-10-01,Alpha,-10.00\n2026-10-02,Beta wire transfer,25.00\n';
  const other = 'Date,Description,Amount\n2026-10-03,Gamma,-5.00\n2026-10-04,Delta wire transfer,40.00\n';
  const a = F.parseCsv(text, { idPrefix: 'csv1' }).rows;
  const b = F.parseCsv(other, { idPrefix: 'csv2' }).rows;
  const merged = F.mergeTransactions(a, b).merged;
  assert.equal(new Set(merged.map((t) => t.id)).size, 4);

  // The app finds a row by id, then sets its kind. Correct the second file's wire (row 3 in its file, the same row number as the first file's).
  const target = merged.find((t) => t.id === 'csv2-3');
  target.kind = 'income';
  assert.equal(merged.find((t) => t.id === 'csv1-3').kind, undefined, 'the first file\'s row 3 is untouched');
  assert.equal(F.kindOf(merged.find((t) => t.id === 'csv1-3')), 'transfer');
  assert.equal(F.kindOf(target), 'income');
});

test('merging repairs colliding ids even if the caller forgot to give each import its own prefix', () => {
  const a = F.parseCsv('Date,Description,Amount\n2026-10-01,A,-1.00\n2026-10-02,B,-2.00\n').rows;
  const b = F.parseCsv('Date,Description,Amount\n2026-10-03,C,-3.00\n2026-10-04,D,-4.00\n').rows;
  assert.equal(a[0].id, b[0].id, 'default ids do collide');
  const m = F.mergeTransactions(a, b);
  assert.equal(m.merged.length, 4);
  assert.equal(new Set(m.merged.map((t) => t.id)).size, 4);
  assert.equal(m.merged.find((t) => t.desc === 'C').cents, -300, 'the right row kept its data');
});

test('displayed category and tag follow the correction', () => {
  const wire = tx('2026-10-05', 120000, { cat: 'Transfer', transfer: true });
  assert.equal(F.displayCategory(wire), 'Transfer');
  const asIncome = Object.assign({}, wire, { kind: 'income' });
  assert.equal(F.displayCategory(asIncome), 'Income');
  assert.equal(F.displayCategory(Object.assign({}, wire, { kind: 'expense' })), 'Other');
  const groceries = tx('2026-10-05', -4000, { cat: 'Groceries' });
  assert.equal(F.displayCategory(groceries), 'Groceries');
  assert.equal(F.displayCategory(Object.assign({}, groceries, { kind: 'transfer' })), 'Transfer');

  // spending by category uses the corrected label too
  const r = { start: '2026-10-01', end: '2026-11-01' };
  const s = F.summarize([Object.assign({}, wire, { cents: -5000, kind: 'expense' })], r);
  assert.deepEqual(s.catsC, { Other: 5000 });
});
