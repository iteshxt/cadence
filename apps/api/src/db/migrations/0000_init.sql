-- Hand-edited after `drizzle-kit generate`: extension, RLS, and the optional auth.users FK.
CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('scheduled', 'deferred', 'sending', 'sent', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"delay_ms" integer NOT NULL,
	"hourly_limit" integer NOT NULL,
	"interval_ms" integer NOT NULL,
	"total_count" integer NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_user_idempotency_key" UNIQUE("user_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"recipient" "citext" NOT NULL,
	"seq" integer NOT NULL,
	"status" "email_status" DEFAULT 'scheduled' NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"message_id" text,
	"preview_url" text,
	"error" text,
	"defer_scope" text,
	"defer_limit" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emails_campaign_recipient" UNIQUE("campaign_id","recipient")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"full_name" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"campaign_id" uuid,
	"window_key" text NOT NULL,
	"scope" text NOT NULL,
	"notified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "senders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"from_email" text NOT NULL,
	"smtp_host" text DEFAULT 'smtp.ethereal.email' NOT NULL,
	"smtp_port" integer DEFAULT 587 NOT NULL,
	"smtp_user" text NOT NULL,
	"smtp_pass_enc" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "senders_from_email_unique" UNIQUE("from_email")
);
--> statement-breakpoint
CREATE TABLE "slack_connections" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"team_name" text NOT NULL,
	"channel_name" text NOT NULL,
	"webhook_url_enc" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_connections" ADD CONSTRAINT "slack_connections_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "emails_user_status_next" ON "emails" USING btree ("user_id","status","next_attempt_at","id");--> statement-breakpoint
CREATE INDEX "emails_user_finished" ON "emails" USING btree ("user_id","finished_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "emails"."status" in ('sent', 'failed');--> statement-breakpoint
CREATE INDEX "emails_status_next" ON "emails" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "emails_sender_finished" ON "emails" USING btree ("sender_id","finished_at") WHERE "emails"."status" = 'sent';--> statement-breakpoint
CREATE INDEX "rate_limit_events_user_created" ON "rate_limit_events" USING btree ("user_id","created_at");--> statement-breakpoint
-- Supabase exposes the public schema through its Data API. RLS with no policies blocks that
-- path entirely; the API connects as the table owner and is unaffected.
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "senders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "emails" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "slack_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rate_limit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- On Supabase, tie profiles to auth.users so deleting a user cascades. Plain Postgres (local
-- development, tests) has no auth schema, so the constraint is skipped there.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'users') THEN
    ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_auth_users_fk"
      FOREIGN KEY ("id") REFERENCES auth.users ("id") ON DELETE CASCADE;
  END IF;
END $$;
