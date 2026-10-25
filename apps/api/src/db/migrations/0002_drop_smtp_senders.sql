-- Hand-edited after `drizzle-kit generate`: fixed the citext type reference.
ALTER TABLE "senders" DROP CONSTRAINT "senders_from_email_unique";--> statement-breakpoint
ALTER TABLE "senders" ALTER COLUMN "from_email" SET DATA TYPE citext;--> statement-breakpoint
ALTER TABLE "senders" DROP COLUMN "smtp_host";--> statement-breakpoint
ALTER TABLE "senders" DROP COLUMN "smtp_port";--> statement-breakpoint
ALTER TABLE "senders" DROP COLUMN "smtp_user";--> statement-breakpoint
ALTER TABLE "senders" DROP COLUMN "smtp_pass_enc";