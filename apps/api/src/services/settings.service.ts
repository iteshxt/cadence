import { LIMITS, type UserSettings } from '@cadence/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { profiles } from '../db/schema.js';

/** The user's Compose defaults (PRD SET-6), stored on the profile. */
export function createSettingsService(deps: { db: Db }) {
  return {
    async get(userId: string): Promise<UserSettings> {
      const [row] = await deps.db
        .select({
          delay: profiles.defaultDelaySeconds,
          hourly: profiles.defaultHourlyLimit,
        })
        .from(profiles)
        .where(eq(profiles.id, userId));
      return {
        defaultDelaySeconds: row?.delay ?? LIMITS.DELAY_DEFAULT_SECONDS,
        defaultHourlyLimit: row?.hourly ?? LIMITS.HOURLY_DEFAULT,
      };
    },

    async save(userId: string, settings: UserSettings): Promise<UserSettings> {
      await deps.db
        .update(profiles)
        .set({
          defaultDelaySeconds: settings.defaultDelaySeconds,
          defaultHourlyLimit: settings.defaultHourlyLimit,
          updatedAt: new Date(),
        })
        .where(eq(profiles.id, userId));
      return settings;
    },
  };
}
