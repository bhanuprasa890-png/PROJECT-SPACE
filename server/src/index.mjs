import { createApp } from './app.mjs';
import { config, describeConfig } from './config.mjs';

const app = createApp();

const server = app.listen(config.port, config.host, () => {
  const info = describeConfig();
  console.log('┌──────────────────────────────────────────────────────────');
  console.log('│ Mise Kitchen Co-Pilot — API');
  console.log(`│ env            ${info.env}`);
  console.log(`│ listening      http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
  console.log(`│ google mode    ${info.googleMode}${info.googleMode === 'demo' ? '  (no GOOGLE_OAUTH_CLIENT_ID set)' : ''}`);
  console.log(`│ cookies        ${info.cookieSecure ? 'Secure + HttpOnly + SameSite=Lax' : 'HttpOnly + SameSite=Lax (dev: Secure off)'}`);
  console.log(`│ session ttl    ${info.sessionTtlDays} days · db: ${info.dbPath}`);
  console.log(`│ secret source  ${info.secretSource}`);
  console.log('└──────────────────────────────────────────────────────────');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
