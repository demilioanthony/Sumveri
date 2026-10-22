const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const F = require('../public/finance.js');

const csv = (...lines) => lines.join('\n');

test('amounts: the formats banks actually use', () => {
  const cents = (s, dc) => F.parseAmount(s, dc).cents;
  assert.equal(cents('$1,234.56'), 123456);
  assert.equal(cents('(45.00)'), -4500);
  assert.equal(cents('-45'), -4500);
  assert.equal(cents('45-'), -4500);
  assert.equal(cents('$-45.00'), -4500);
  assert.equal(cents('-$45.00'), -4500);
  assert.equal(cents('+12.5'), 1250);
  assert.equal(cents('.5'), 50);
  assert.equal(cents('12,50', true), 1250);
  assert.equal(cents('1.234,56', true), 123456);
  assert.equal(cents(' 7 '), 700);
});

test('amounts: bad values are reported, not guessed', () => {
  assert.ok(F.parseAmount('abc').error);
  assert.ok(F.parseAmount('12.345').error);
  assert.ok(F.parseAmount('1,23').error);
  assert.ok(F.parseAmount('--5').error);
  assert.ok(F.parseAmount('$').error);
  assert.ok(F.parseAmount('99999999999999999999').error);
  assert.ok(F.parseAmount('').empty);
  assert.ok(F.parseAmount(null).empty);
});

test('dates are read as written, with a real calendar check', () => {
  assert.equal(F.parseDate('10/05/2026'), '2026-10-05');
  assert.equal(F.parseDate('10/05/2026', 'dmy'), '2026-05-10');
  assert.equal(F.parseDate('3/4/26'), '2026-03-04');
  assert.equal(F.parseDate('2026-10-05'), '2026-10-05');
  assert.equal(F.parseDate('2026/10/05'), '2026-10-05');
  assert.equal(F.parseDate('Oct 5, 2026'), '2026-10-05');
  assert.equal(F.parseDate('October 5, 2026'), '2026-10-05');
  assert.equal(F.parseDate('5 Oct 2026'), '2026-10-05');
  assert.equal(F.parseDate('05-Oct-26'), '2026-10-05');
  assert.equal(F.parseDate('2028-02-29'), '2028-02-29');
  assert.equal(F.parseDate('2027-02-29'), null);
  assert.equal(F.parseDate('02/30/2026'), null);
  assert.equal(F.parseDate('13/45/2026'), null);
  assert.equal(F.parseDate('yesterday'), null);
  assert.equal(F.parseDate(''), null);
});

test('a time or time zone after the date never moves the date', () => {
  assert.equal(F.parseDate('2026-10-05T23:59:59-04:00'), '2026-10-05');
  assert.equal(F.parseDate('2026-10-05T00:00:00Z'), '2026-10-05');
  assert.equal(F.parseDate('2026-10-05 00:00:01'), '2026-10-05');
  assert.equal(F.parseDate('10/05/2026 11:30 PM'), '2026-10-05');
});

test('the same file gives the same dates in every time zone', () => {
  const script = `
    const F = require(${JSON.stringify(path.join(__dirname, '..', 'public', 'finance.js'))});
    const r = F.parseCsv('Date,Description,Amount\\n2026-03-08T23:30:00-05:00,A,-1\\n10/05/2026,B,-2\\n\"Dec 31, 2026\",C,-3\\n2026-11-01,D,-4');
    const month = F.range('month', 0, '2026-11-01');
    console.log(JSON.stringify([r.rows.map(t => t.date), month, F.summarize(r.rows, month).expenseC]));`;
  const outputs = ['UTC', 'Pacific/Pago_Pago', 'Pacific/Kiritimati', 'America/Los_Angeles', 'Australia/Lord_Howe', 'Europe/London']
    .map((tz) => execFileSync(process.execPath, ['-e', script], { env: Object.assign({}, process.env, { TZ: tz }) }).toString().trim());
  for (const o of outputs) assert.equal(o, outputs[0]);
  assert.deepEqual(JSON.parse(outputs[0])[0], ['2026-03-08', '2026-10-05', '2026-12-31', '2026-11-01']);
  assert.equal(JSON.parse(outputs[0])[2], 400);
});

test('a basic file', () => {
  const r = F.parseCsv(csv('Date,Description,Amount', '2026-10-05,Coffee,-4.50', '2026-10-06,Paycheck,"2,450.00"'));
  assert.equal(r.fileError, null);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].cents, -450);
  assert.equal(r.rows[1].cents, 245000);
  assert.equal(r.rows[1].cat, 'Income');
  assert.equal(r.rows[0].cat, 'Imported');
  assert.equal(r.minDate, '2026-10-05');
  assert.equal(r.maxDate, '2026-10-06');
  assert.deepEqual(r.stats, { incomeC: 245000, expenseC: 450, incomeN: 1, expenseN: 1, transferN: 0, transferC: 0 });
});

test('quoted commas, doubled quotes, line breaks inside a value, and a byte-order mark', () => {
  const text = '﻿Date,Description,Amount\r\n2026-10-05,"Smith, J ""Bob"" & Sons",-10.00\r\n2026-10-06,"Line one\nline two",-5.00\r\n';
  const r = F.parseCsv(text);
  assert.equal(r.fileError, null);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].desc, 'Smith, J "Bob" & Sons');
  assert.equal(r.rows[1].desc, 'Line one line two');
});

test('bad rows are reported with their row number and the good rows still load', () => {
  const r = F.parseCsv(csv(
    'Date,Description,Amount', // row 1
    '2026-10-01,Good one,-1.00', // row 2
    '13/45/2026,Bad date,-2.00', // row 3
    '2026-10-03,Bad amount,abc', // row 4
    '', // row 5, blank
    '2026-10-05,Empty amount,', // row 6
    ',No date,-3.00', // row 7
    '2026-10-08,Zero,0.00', // row 8
    '2026-10-09,Good two,-9.00', // row 9
  ));
  assert.equal(r.rows.length, 2);
  assert.equal(r.total, 7);
  assert.equal(r.blank, 1);
  assert.deepEqual(r.errors.map((e) => e.row), [3, 4, 6, 7, 8]);
  assert.match(r.errors[0].message, /could not read the date "13\/45\/2026"/);
  assert.match(r.errors[1].message, /the amount "abc" is not a number/);
  assert.match(r.errors[2].message, /amount is empty/);
  assert.match(r.errors[3].message, /date is empty/);
  assert.match(r.errors[4].message, /0\.00/);
});

test('file-level problems are explained and nothing is imported', () => {
  assert.match(F.parseCsv('').fileError, /empty/);
  assert.match(F.parseCsv('   \n  ').fileError, /empty/);
  assert.match(F.parseCsv('Name,Amount\nA,1').fileError, /Date column/);
  assert.match(F.parseCsv('Date,Description\n2026-10-01,A').fileError, /Amount column/);
  assert.match(F.parseCsv('Date,Description,Amount\n2026-10-01,"unclosed,-5').fileError, /quote/);
  const huge = 'Date,Description,Amount\n' + '2026-10-01,A,-1\n'.repeat(F.MAX_ROWS + 1);
  assert.match(F.parseCsv(huge).fileError, /more than 50,000 rows/);
  assert.equal(F.parseCsv('Date,Description,Amount\n2026-10-01,A,-1').fileError, null);
});

test('separate debit and credit columns', () => {
  const r = F.parseCsv(csv('Posting Date,Memo,Debit,Credit', '10/02/2026,Rent,1200.00,', '10/03/2026,Pay,,2000.00', '10/04/2026,Odd,-15.00,', '10/05/2026,Nothing,,'));
  assert.equal(r.rows.length, 3);
  assert.deepEqual(r.rows.map((t) => t.cents), [-120000, 200000, -1500]);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /both the debit and credit are empty/);
});

test('files that show spending as positive can be flipped', () => {
  const text = csv('Date,Description,Amount', '2026-10-01,Store,25.00', '2026-10-02,Payment received,-100.00');
  const normal = F.parseCsv(text);
  assert.equal(normal.rows[0].cents, 2500);
  const flipped = F.parseCsv(text, { spendingPositive: true });
  assert.equal(flipped.rows[0].cents, -2500);
  assert.equal(flipped.rows[1].cents, 10000);
  assert.ok(F.parseCsv(csv('Date,Amount', '2026-10-01,5', '2026-10-02,6')).allPositive);
  assert.ok(!normal.allPositive);
});

test('day-first and month-first dates', () => {
  const dayFirst = F.parseCsv(csv('Date,Description,Amount', '25/03/2026,A,-1', '04/05/2026,B,-2'));
  assert.equal(dayFirst.dateOrder, 'dmy');
  assert.deepEqual(dayFirst.rows.map((t) => t.date), ['2026-03-25', '2026-05-04']);
  assert.equal(dayFirst.dateOrderGuessed, false);

  const monthFirst = F.parseCsv(csv('Date,Description,Amount', '03/25/2026,A,-1', '04/05/2026,B,-2'));
  assert.equal(monthFirst.dateOrder, 'mdy');
  assert.deepEqual(monthFirst.rows.map((t) => t.date), ['2026-03-25', '2026-04-05']);

  const unclear = F.parseCsv(csv('Date,Description,Amount', '04/05/2026,A,-1'));
  assert.equal(unclear.dateOrder, 'mdy');
  assert.equal(unclear.dateOrderGuessed, true);
  const forced = F.parseCsv(csv('Date,Description,Amount', '04/05/2026,A,-1'), { dateOrder: 'dmy' });
  assert.equal(forced.rows[0].date, '2026-05-04');
  assert.equal(forced.dateOrderGuessed, false);

  assert.equal(F.parseCsv(csv('Date,Description,Amount', '25/03/2026,A,-1', '03/25/2026,B,-1')).mixedDates, true);
});

test('rows that look like transfers are flagged so they stay out of income and expenses', () => {
  const r = F.parseCsv(csv('Date,Description,Amount,Category', '2026-10-01,Online Transfer to Savings,-500.00,', '2026-10-02,Venmo,-20.00,Transfer', '2026-10-03,Transferwise fee,-2.00,', '2026-10-04,Cafe,-3.00,Dining'));
  assert.deepEqual(r.rows.map((t) => t.transfer), [true, true, false, false]);
  assert.equal(r.stats.transferN, 2);
  assert.equal(r.stats.transferC, 52000);
  assert.equal(r.stats.expenseC, 500);
  assert.equal(r.rows[3].cat, 'Dining');
});

test('merging skips duplicates and keeps genuine repeats', () => {
  const existing = [
    { date: '2026-10-01', cents: -500, desc: 'Coffee' },
    { date: '2026-10-02', cents: -900, desc: 'Lunch' },
  ];
  const incoming = [
    { date: '2026-10-01', cents: -500, desc: '  coffee ' }, // same as existing, different case and spacing
    { date: '2026-10-02', cents: -900, desc: 'Lunch' }, // same as existing
    { date: '2026-10-02', cents: -900, desc: 'Lunch' }, // a second identical lunch on the same day
    { date: '2026-10-03', cents: -100, desc: 'New' },
  ];
  const m = F.mergeTransactions(existing, incoming);
  assert.equal(m.duplicates, 2);
  assert.equal(m.added, 2);
  assert.equal(m.merged.length, 4);
  const again = F.mergeTransactions(m.merged, incoming);
  assert.equal(again.added, 0, 'importing the same file again adds nothing');
  assert.equal(again.merged.length, 4);
});

test('the preview is a pure read: parsing never changes what is on screen', () => {
  const shown = [{ date: '2026-10-01', cents: -500, desc: 'Coffee' }];
  const copy = JSON.stringify(shown);
  F.parseCsv(csv('Date,Description,Amount', '2026-10-02,A,-1'));
  F.mergeTransactions(shown, [{ date: '2026-10-02', cents: -100, desc: 'A' }]);
  assert.equal(JSON.stringify(shown), copy);
});

// ---------- decimal format: the 12.50 -> 1,250.00 bug ----------
const amounts = (r) => r.rows.map((t) => t.cents);

test('decimal point files: 12.50 is twelve dollars fifty, in comma- and semicolon-separated files alike', () => {
  const comma = F.parseCsv(csv('Date,Description,Amount', '2026-10-01,A,12.50', '2026-10-02,B,"-1,234.56"', '2026-10-03,C,$0.99'));
  assert.deepEqual(amounts(comma), [1250, -123456, 99]);
  assert.equal(comma.decimal, 'point');

  const semi = F.parseCsv(csv('Date;Description;Amount', '2026-10-01;A;12.50', '2026-10-02;B;-1,234.56', '2026-10-03;C;3.40'));
  assert.equal(semi.delimiter, ';');
  assert.deepEqual(amounts(semi), [1250, -123456, 340], 'a semicolon must not switch the file to decimal commas');
  assert.equal(semi.decimal, 'point');
  assert.equal(semi.errors.length, 0);
});

test('decimal comma files: 1.234,56 is one thousand two hundred thirty-four dollars fifty-six', () => {
  const r = F.parseCsv(csv('Date;Description;Amount', '2026-10-01;Bakery;-3,40', '2026-10-02;Salary;1.500,00', '2026-10-03;Rent;-1.234,56', '2026-10-04;Gift;12,5'), { decimal: 'comma' });
  assert.deepEqual(amounts(r), [-340, 150000, -123456, 1250]);
  assert.equal(r.decimal, 'comma');
  assert.equal(r.errors.length, 0);
});

test('with no choice made, clear evidence in the file picks the format and says it did', () => {
  const eu = F.parseCsv(csv('Date;Description;Amount', '2026-10-01;A;-3,40', '2026-10-02;B;1.500,00'));
  assert.equal(eu.decimal, 'comma');
  assert.equal(eu.decimalGuessed, true);
  assert.deepEqual(amounts(eu), [-340, 150000]);

  const us = F.parseCsv(csv('Date,Description,Amount', '2026-10-01,A,3.40'));
  assert.equal(us.decimal, 'point');
  assert.equal(us.decimalGuessed, true);
});

test('the wrong choice is refused row by row instead of producing wrong amounts', () => {
  // The dangerous case: reading 12.50 as a decimal-comma number would strip the dot and give 1250.00.
  const wrongComma = F.parseCsv(csv('Date,Description,Amount', '2026-10-01,A,12.50', '2026-10-02,B,3.00'), { decimal: 'comma' });
  assert.equal(wrongComma.rows.length, 0);
  assert.equal(wrongComma.errors.length, 2);
  assert.match(wrongComma.errors[0].message, /decimal point/);

  const wrongPoint = F.parseCsv(csv('Date;Description;Amount', '2026-10-01;A;12,50', '2026-10-02;B;1.234,56'), { decimal: 'point' });
  assert.equal(wrongPoint.rows.length, 0);
  assert.equal(wrongPoint.errors.length, 2);
  assert.match(wrongPoint.errors[0].message, /decimal comma/);
});

test('values that fit both formats are flagged, and mixed files are called out', () => {
  const unclear = F.parseCsv(csv('Date,Description,Amount', '2026-10-01,A,"1,234"', '2026-10-02,B,500'));
  assert.equal(unclear.decimalUnclear, true);
  assert.equal(unclear.decimalGuessed, false);
  assert.deepEqual(amounts(unclear), [123400, 50000], 'point is the default');
  const asComma = F.parseCsv(csv('Date,Description,Amount', '2026-10-01,A,"1,234"'), { decimal: 'comma' });
  assert.equal(asComma.rows.length, 0, '1,234 with a decimal comma is 1.234, which has too many decimals, so it is refused');
  assert.equal(asComma.errors.length, 1);

  const mixed = F.parseCsv(csv('Date;Description;Amount', '2026-10-01;A;12.50', '2026-10-02;B;3,40'));
  assert.equal(mixed.decimalConflict, true);
});

test('debit and credit columns use the chosen decimal format too', () => {
  const r = F.parseCsv(csv('Date;Description;Debit;Credit', '2026-10-01;Shop;12,50;', '2026-10-02;Pay;;1.000,00'), { decimal: 'comma' });
  assert.deepEqual(amounts(r), [-1250, 100000]);
  const p = F.parseCsv(csv('Date;Description;Debit;Credit', '2026-10-01;Shop;12.50;', '2026-10-02;Pay;;1,000.00'), { decimal: 'point' });
  assert.deepEqual(amounts(p), [-1250, 100000]);
});

test('each row keeps the text it was read from, so the preview can show it next to the result', () => {
  const r = F.parseCsv(csv('Date;Description;Amount', '2026-10-01;A;"1.234,56"'), { decimal: 'comma' });
  assert.equal(r.rows[0].raw, '1.234,56');
  assert.equal(r.rows[0].cents, 123456);
});

test('the sample files shipped in docs/ read the way the README says they do', () => {
  const fs = require('node:fs');
  const read = (f) => F.parseCsv(fs.readFileSync(path.join(__dirname, '..', 'docs', f), 'utf8'));
  const comma = read('sample-decimal-comma.csv');
  assert.equal(comma.decimal, 'comma');
  assert.deepEqual(amounts(comma), [245000, -135000, -340, -40000, -6215]);
  const point = read('sample-semicolon-decimal-point.csv');
  assert.equal(point.delimiter, ';');
  assert.equal(point.decimal, 'point');
  assert.deepEqual(amounts(point), [245000, -135000, -340, -6215]);
  const main = read('sample-transactions.csv');
  assert.equal(main.rows.length, 10);
  assert.equal(main.errors.length, 1);
});
