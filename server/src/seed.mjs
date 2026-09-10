/**
 * Seeds the demo identities. Run directly (`npm run seed`) or automatically at
 * boot in non-production mode. Demo passcodes are stored as scrypt hashes like
 * any other credential — they are only "known" because they are public demo
 * fixtures declared here (and overridable with DEMO_PASSCODE in .env).
 */
import { config } from './config.mjs';
import { getDb, nowIso, tx } from './db.mjs';
import { hashPassword } from './crypto.mjs';

export const DEMO_GOOGLE_ACCOUNTS = [
  {
    email: 'priya.nair@gmail.com',
    name: 'Priya Nair',
    role: 'Weeknight cook · Bengaluru',
    color: '#FF8A3D',
    favorites: ['garlic-butter-paneer', 'weeknight-dal'],
    cooked: ['weeknight-dal', 'tomato-onion-chutney', 'green-curry-coconut-soup'],
  },
  {
    email: 'arjun.mehta@gmail.com',
    name: 'Arjun Mehta',
    role: 'Bread + fermenting · Pune',
    color: '#7ED9A6',
    favorites: ['masala-dosa', 'fluffy-pancakes'],
    cooked: ['masala-dosa', 'hyderabadi-chicken-biryani'],
  },
  {
    email: 'sana.cooks@gmail.com',
    name: 'Sana Qureshi',
    role: 'Sunday batch cook · Hyderabad',
    color: '#7CC5F7',
    favorites: ['smoked-butter-chicken', 'hyderabadi-chicken-biryani', 'soy-ginger-chicken'],
    cooked: ['smoked-butter-chicken'],
  },
];

export const DEMO_PASSWORD_ACCOUNT = {
  email: 'chef@mise.dev',
  name: 'Mise Demo Chef',
  password: 'MiseDemo#2026',
  role: 'Local demo login',
};

function seedOne(db, passcode) {
  for (const account of DEMO_GOOGLE_ACCOUNTS) {
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(account.email);
    const id = existing
      ? existing.id
      : Number(
          db
            .prepare(`INSERT INTO users (email, name, avatar_url, provider, google_sub, created_at) VALUES (?, ?, NULL, 'google', ?, ?)`)
            .run(account.email, account.name, `demo-${account.email}`, nowIso()).lastInsertRowid
        );
    db.prepare('UPDATE users SET demo_code_hash = ?, name = ? WHERE id = ?').run(hashPassword(passcode), account.name, id);
    for (const recipeId of account.favorites) {
      db.prepare('INSERT INTO recipe_state (user_id, recipe_id, favorite, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(user_id, recipe_id) DO UPDATE SET favorite = 1, updated_at = excluded.updated_at').run(id, recipeId, nowIso());
    }
    for (const recipeId of account.cooked) {
      db.prepare('INSERT INTO recipe_state (user_id, recipe_id, cooked_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, recipe_id) DO UPDATE SET cooked_at = excluded.cooked_at').run(id, recipeId, nowIso(), nowIso());
    }
  }

  const local = db.prepare('SELECT id FROM users WHERE email = ?').get(DEMO_PASSWORD_ACCOUNT.email);
  if (!local) {
    db.prepare(`INSERT INTO users (email, name, provider, password_hash, created_at) VALUES (?, ?, 'password', ?, ?)`).run(
      DEMO_PASSWORD_ACCOUNT.email,
      DEMO_PASSWORD_ACCOUNT.name,
      hashPassword(DEMO_PASSWORD_ACCOUNT.password),
      nowIso()
    );
  }
}

/**
 * @param {{force?: boolean}} opts force=true rewrites the demo passcode hash
 *   (use it when you change DEMO_PASSCODE), otherwise seeding is idempotent.
 */
export function seedDatabase({ force = false } = {}) {
  const db = getDb();
  const passcode = config.demo.passcode;
  tx(() => seedOne(db, passcode));
  const counts = db.prepare('SELECT COUNT(*) AS users FROM users').get();
  return { users: counts.users, forced: force };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const force = process.argv.includes('--force');
  const result = seedDatabase({ force });
  console.log(
    `[seed] users in DB: ${result.users}${force ? ' (passcodes rewritten)' : ''}\n` +
      `[seed] demo Google accounts: ${DEMO_GOOGLE_ACCOUNTS.map((a) => a.email).join(', ')} · passcode: ${config.demo.passcode}\n` +
      `[seed] local login: ${DEMO_PASSWORD_ACCOUNT.email} · password: ${config.demo.password}`
  );
}
