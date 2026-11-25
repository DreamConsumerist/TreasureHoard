CREATE TYPE "sync_job" AS ENUM('tcg', 'games');--> statement-breakpoint
CREATE TYPE "sync_status" AS ENUM('running', 'ok', 'partial', 'failed');--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sync_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"job" "sync_job" NOT NULL,
	"trigger" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "sync_status" DEFAULT 'running'::"sync_status" NOT NULL,
	"ok_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE INDEX "sync_runs_job_idx" ON "sync_runs" ("job","started_at");