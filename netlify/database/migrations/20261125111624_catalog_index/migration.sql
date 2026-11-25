ALTER TYPE "sync_job" ADD VALUE 'catalog';--> statement-breakpoint
CREATE TABLE "catalog_groups" (
	"group_id" integer PRIMARY KEY,
	"category_id" integer NOT NULL,
	"name" text NOT NULL,
	"abbreviation" text,
	"published_on" date,
	"modified_on" text,
	"products_synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "catalog_products" (
	"product_id" integer PRIMARY KEY,
	"category_id" integer NOT NULL,
	"group_id" integer NOT NULL,
	"name" text NOT NULL,
	"number" text,
	"rarity" text,
	"image_url" text,
	"sealed" boolean NOT NULL
);
--> statement-breakpoint
CREATE INDEX "catalog_groups_category_idx" ON "catalog_groups" ("category_id");--> statement-breakpoint
CREATE INDEX "catalog_products_name_idx" ON "catalog_products" ("category_id",lower("name"));--> statement-breakpoint
CREATE INDEX "catalog_products_group_idx" ON "catalog_products" ("group_id");--> statement-breakpoint
ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_group_id_catalog_groups_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "catalog_groups"("group_id") ON DELETE CASCADE;