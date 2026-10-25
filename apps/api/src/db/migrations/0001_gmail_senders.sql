-- Hand-edited after `drizzle-kit generate`: retires the v1 shared Ethereal senders (tech-spec §4).
ALTER TABLE "profiles" ADD COLUMN "default_delay_seconds" integer;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "default_hourly_limit" integer;--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "provider" text DEFAULT 'gmail' NOT NULL;--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "hourly_limit" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "refresh_token_enc" text;--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "needs_reconnect" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "senders" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "senders" ADD CONSTRAINT "senders_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "senders_user_active" ON "senders" USING btree ("user_id","is_active");--> statement-breakpoint
ALTER TABLE "senders" ADD CONSTRAINT "senders_user_from_email" UNIQUE("user_id","from_email");--> statement-breakpoint
-- The shared Ethereal senders have no owner. They stay (inactive) so past emails keep their
-- sender; pending emails on them fail as "sender disconnected" when they come due.
UPDATE "senders" SET "is_active" = false, "updated_at" = now() WHERE "user_id" IS NULL;
