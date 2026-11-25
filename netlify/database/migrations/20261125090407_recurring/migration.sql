CREATE TYPE "recurring_frequency" AS ENUM('week', 'month', 'year');--> statement-breakpoint
CREATE TABLE "recurring_template_postings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "recurring_template_postings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"template_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"amount_cents" bigint NOT NULL,
	"memo" text,
	CONSTRAINT "recurring_postings_amount_nonzero" CHECK ("amount_cents" <> 0)
);
--> statement-breakpoint
CREATE TABLE "recurring_templates" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "recurring_templates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"description" text NOT NULL,
	"notes" text,
	"frequency" "recurring_frequency" NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"next_index" integer DEFAULT 0 NOT NULL,
	"variable" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_interval_positive" CHECK ("interval" >= 1),
	CONSTRAINT "recurring_end_after_start" CHECK ("end_date" is null or "end_date" >= "start_date")
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "recurring_template_id" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "occurrence_date" date;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_occurrence_unique" UNIQUE("recurring_template_id","occurrence_date");--> statement-breakpoint
CREATE INDEX "recurring_postings_template_idx" ON "recurring_template_postings" ("template_id");--> statement-breakpoint
ALTER TABLE "recurring_template_postings" ADD CONSTRAINT "recurring_template_postings_QOsld9u2z9sx_fkey" FOREIGN KEY ("template_id") REFERENCES "recurring_templates"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "recurring_template_postings" ADD CONSTRAINT "recurring_template_postings_account_id_accounts_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_template_id_recurring_templates_id_fkey" FOREIGN KEY ("recurring_template_id") REFERENCES "recurring_templates"("id") ON DELETE SET NULL;