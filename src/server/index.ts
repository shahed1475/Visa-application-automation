import { buildServer } from './app.js';
import { env } from './env.js';

const app = await buildServer({ dbPath: env.DB_PATH });

try {
  await app.listen({ host: '127.0.0.1', port: env.PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
