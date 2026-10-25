import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '../src/db/migrate.js';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
  }
}

/**
 * Starts throwaway Postgres and Redis containers (or reuses TEST_DATABASE_URL / TEST_REDIS_URL,
 * for example the docker-compose services) and applies the migrations once.
 */
export default async function setup(project: TestProject) {
  const reuse = process.env.TEST_DATABASE_URL && process.env.TEST_REDIS_URL;
  if (reuse) {
    await runMigrations(process.env.TEST_DATABASE_URL!);
    project.provide('databaseUrl', process.env.TEST_DATABASE_URL!);
    project.provide('redisUrl', process.env.TEST_REDIS_URL!);
    return;
  }

  const [pg, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:17-alpine').start(),
    new RedisContainer('redis:7.4-alpine').start(),
  ]);
  await runMigrations(pg.getConnectionUri());
  project.provide('databaseUrl', pg.getConnectionUri());
  project.provide('redisUrl', redis.getConnectionUrl());

  return async () => {
    await Promise.all([pg.stop(), redis.stop()]);
  };
}
