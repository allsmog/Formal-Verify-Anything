import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Budget, OutputExcerpt, canonicalDigest } from '../src/support.mjs';

const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');

test('budget refuses charges that do not fit and leaves the count unchanged', () => {
  const budget = new Budget(3);
  assert.equal(budget.tryCharge(2), true);
  assert.equal(budget.tryCharge(2), false);
  assert.deepEqual([budget.used, budget.remaining], [2, 1]);
  for (const invalid of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) assert.equal(budget.tryCharge(invalid), false);
  assert.equal(budget.tryCharge(1), true);
  assert.equal(budget.remaining, 0);
  assert.throws(() => new Budget(-1), RangeError);
});

test('canonical digest hashes RFC 8785 canonical JSON', () => {
  // Key order by UTF-16 code units, ECMAScript number form, no whitespace.
  const value = { '€': 'Euro Sign', '\r': 'Carriage Return', 'דּ': 'Hebrew Letter Dalet With Dagesh',
    '1': 'One', '\u{1f600}': 'Emoji: Grinning Face', '\u0080': 'Control', 'ö': 'Latin Small Letter O With Diaeresis' };
  const expected = '{"\\r":"Carriage Return","1":"One","\u0080":"Control","ö":"Latin Small Letter O With Diaeresis",'
    + '"€":"Euro Sign","\u{1f600}":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}';
  assert.equal(canonicalDigest(value), sha256(expected));
  assert.equal(canonicalDigest({ numbers: [333333333.33333329, 1e30, 4.50, 2e-3, 0.000000000000000000000000001, -0] }),
    sha256('{"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27,0]}'));
  assert.equal(canonicalDigest({ b: undefined, a: [undefined, () => 1] }), sha256('{"a":[null,null]}'));
  assert.equal(canonicalDigest('text'), sha256('"text"'));
});

test('canonical digest refuses values JSON cannot represent', () => {
  const circular = {};
  circular.self = circular;
  assert.throws(() => canonicalDigest(circular), /circular/);
  assert.throws(() => canonicalDigest(Number.NaN), /non-finite/);
  assert.throws(() => canonicalDigest(undefined), TypeError);
  assert.throws(() => canonicalDigest(1n), TypeError);
});

test('output excerpt keeps both ends and never splits a code point', () => {
  const short = new OutputExcerpt(16);
  short.append(Buffer.from('hello '));
  short.append(Buffer.from('world'));
  assert.deepEqual([short.text, short.truncated], ['hello world', false]);

  const long = new OutputExcerpt(8);
  for (const chunk of ['ab€', 'cdefgh', 'ij€k']) long.append(Buffer.from(chunk));
  assert.equal(long.truncated, true);
  // Head keeps 4 bytes ("ab" plus two of the three euro bytes): the cut
  // character is dropped. Tail keeps the last 4 bytes, the euro sign and "k".
  assert.equal(long.text, 'ab … [output omitted] … €k');

  const empty = new OutputExcerpt(0);
  empty.append(Buffer.from('x'));
  assert.equal(empty.text, ' … [output omitted] … ');
});
