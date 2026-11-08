import 'server-only';

import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';

import * as schema from './schema';

let pool: Pool | undefined;
let client: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getDb() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required for database access.');
    pool = new Pool({ connectionString: url });
    client = drizzle(pool, { schema });
  }

  return client;
}
