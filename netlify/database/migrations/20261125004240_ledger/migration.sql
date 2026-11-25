CREATE TYPE "account_type" AS ENUM('asset', 'liability', 'equity', 'income', 'expense');--> statement-breakpoint
CREATE TYPE "txn_kind" AS ENUM('normal', 'opening');--> statement-breakpoint
CREATE TYPE "txn_status" AS ENUM('pending', 'cleared');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"type" "account_type" NOT NULL,
	"parent_id" integer,
	"system_key" text UNIQUE,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_parent_name_unique" UNIQUE NULLS NOT DISTINCT("parent_id","name")
);
--> statement-breakpoint
CREATE TABLE "postings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "postings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"transaction_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"amount_cents" bigint NOT NULL,
	"memo" text,
	CONSTRAINT "postings_amount_nonzero" CHECK ("amount_cents" <> 0)
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"date" date NOT NULL,
	"description" text NOT NULL,
	"notes" text,
	"status" "txn_status" DEFAULT 'cleared'::"txn_status" NOT NULL,
	"kind" "txn_kind" DEFAULT 'normal'::"txn_kind" NOT NULL,
	"external_id" text UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "postings_account_idx" ON "postings" ("account_id");--> statement-breakpoint
CREATE INDEX "postings_transaction_idx" ON "postings" ("transaction_id");--> statement-breakpoint
CREATE INDEX "transactions_date_id_idx" ON "transactions" ("date" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_id_accounts_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "accounts"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "postings" ADD CONSTRAINT "postings_transaction_id_transactions_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "postings" ADD CONSTRAINT "postings_account_id_accounts_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT;