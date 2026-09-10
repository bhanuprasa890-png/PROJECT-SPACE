import './env.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  hashPassword,
  makeCsrfToken,
  normalizeEmail,
  passwordProblems,
  passwordStrength,
  sha256,
  verifyCsrfToken,
  verifyPassword,
} from '../src/crypto.mjs';

describe('password hashing', () => {
  test('round-trips a correct password', () => {
    const hash = hashPassword('MiseDemo#2026');
    assert.equal(verifyPassword('MiseDemo#2026', hash), true);
  });

  test('rejects a wrong password', () => {
    const hash = hashPassword('MiseDemo#2026');
    assert.equal(verifyPassword('MiseDemo#2027', hash), false);
  });

  test('never stores anything resembling the plaintext', () => {
    const secret = 'Correct-Horse-Battery-9!';
    const hash = hashPassword(secret);
    assert.doesNotMatch(hash, new RegExp(secret));
    assert.match(hash, /^scrypt\$v1\$16384\$8\$1\$[\w-]+\$[\w-]+$/);
  });

  test('salts every hash (two hashes of the same password differ)', () => {
    assert.notEqual(hashPassword('same-pass'), hashPassword('same-pass'));
  });

  test('rejects malformed or foreign hash formats', () => {
    assert.equal(verifyPassword('x', ''), false);
    assert.equal(verifyPassword('x', null), false);
    assert.equal(verifyPassword('x', 'bcrypt$1$2$3$4$5'), false);
    assert.equal(verifyPassword('x', 'scrypt$v2$16384$8$1$abc$def'), false);
    assert.equal(verifyPassword('x', 'scrypt$v1$16384$8$1$notbase64!!$also-not'), false);
  });

  test('sha256 is stable and used for token storage', () => {
    assert.equal(sha256('abc'), sha256('abc'));
    assert.equal(sha256('abc').length, 64);
    assert.notEqual(sha256('abc'), 'abc');
  });
});

describe('email normalisation', () => {
  test('case-folds and trims so login matches registration', () => {
    assert.equal(normalizeEmail('  Priya.Nair@Gmail.COM '), 'priya.nair@gmail.com');
  });
  test('survives nullish input', () => {
    assert.equal(normalizeEmail(undefined), '');
  });
});

describe('password policy', () => {
  test('flags short passwords', () => {
    assert.ok(passwordProblems('Sh0rt!').some((p) => /at least/.test(p)));
  });
  test('flags common passwords and single character classes', () => {
    assert.ok(passwordProblems('aaaaaaaaaa').some((p) => /repeating/.test(p)));
    assert.ok(passwordProblems('abcdefghij').some((p) => /common|two of/.test(p)));
  });
  test('flags email/name reuse', () => {
    assert.ok(passwordProblems('priya.nair12345', { email: 'priya.nair@gmail.com' }).some((p) => /email/.test(p)));
    assert.ok(passwordProblems('ArjunMehta2024x', { name: 'ArjunMehta' }).some((p) => /name/.test(p)));
  });
  test('accepts a strong password', () => {
    assert.deepEqual(passwordProblems('Saffron#Pan2026!'), []);
  });
  test('strength score increases with quality', () => {
    assert.ok(passwordStrength('password') < passwordStrength('Saffron#Pan2026!x'));
    assert.equal(passwordStrength(''), 0);
  });
});

describe('csrf tokens', () => {
  test('verifies the matching session and rejects others', () => {
    const token = makeCsrfToken('sess-123');
    assert.equal(verifyCsrfToken('sess-123', token), true);
    assert.equal(verifyCsrfToken('sess-999', token), false);
    assert.equal(verifyCsrfToken('sess-123', 'sess-123.deadbeef'), false);
    assert.equal(verifyCsrfToken('', token), false);
    assert.equal(verifyCsrfToken('sess-123', undefined), false);
  });
});
