/**
 * Import this FIRST in every test file: it pins the environment before any
 * application module reads config.
 */
process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.SESSION_SECRET = 'a'.repeat(24) + 'b'.repeat(24);
process.env.COOKIE_SECURE = 'false';
process.env.SHOW_DEMO_CREDENTIALS = 'true';
process.env.RATE_LIMIT_MAX = '100000';
process.env.RATE_LIMIT_MAX_FAILURES = '5';
process.env.DEMO_PASSCODE = 'MiseDemo#2026';
