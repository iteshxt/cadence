-- Hand-edited after `drizzle-kit generate`: pg_trgm for the recipient index (tech-spec §11).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "search_tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', subject), 'A') || setweight(to_tsvector('simple', body), 'B')) STORED;--> statement-breakpoint
CREATE INDEX "campaigns_search_tsv" ON "campaigns" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "emails_recipient_trgm" ON "emails" USING gin (("recipient"::text) gin_trgm_ops);