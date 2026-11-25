CREATE TABLE "item_groups" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "item_groups_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"notes" text,
	"cover_item_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "item_group_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "item_groups_name_unique" ON "item_groups" (lower("name"));--> statement-breakpoint
CREATE INDEX "items_item_group_idx" ON "items" ("item_group_id");--> statement-breakpoint
ALTER TABLE "item_groups" ADD CONSTRAINT "item_groups_cover_item_id_items_id_fkey" FOREIGN KEY ("cover_item_id") REFERENCES "items"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_item_group_id_item_groups_id_fkey" FOREIGN KEY ("item_group_id") REFERENCES "item_groups"("id") ON DELETE SET NULL;