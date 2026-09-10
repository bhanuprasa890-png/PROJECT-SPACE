import { createApp } from './app';
import { closeDb, getDb } from './db/client';
import { runMigrations } from './db/migrate';
import { env } from './config/env';

async function main(): Promise<void> {
  const db = await getDb();

  if (env.database.autoMigrate) {
    const report = await runMigrations(db);
    console.log(
      `[db] ${db.kind} ready · schema ${report.schemaVersion ?? 'unknown'} · ` +
        `applied ${report.applied.length}, replayed ${report.replayed.length}, ` +
        `seeds ${report.seedsApplied.length}`,
    );
    if (report.applied.length) console.log(`[db] migrations: ${report.applied.join(', ')}`);
    if (report.seedsApplied.length) console.log(`[db] seeds: ${report.seedsApplied.join(', ')}`);
  } else {
    console.log(`[db] ${db.kind} connected (auto-migrate disabled)`);
  }

  const app = createApp();
  const server = app.listen(env.port, '0.0.0.0', () => {
    console.log(
      `[api] TransitPulse AI listening on http://0.0.0.0:${env.port} (${env.nodeEnv})`,
    );
    console.log(`[api] model ${env.modelVersion} · profile ${env.defaultProfileId}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[api] ${signal} received — shutting down`);
    server.close();
    await closeDb();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[api] failed to start:', error);
  process.exit(1);
});
