CREATE TYPE "basis_source" AS ENUM('purchase', 'baseline');--> statement-breakpoint
CREATE TYPE "game_variant" AS ENUM('loose', 'cib', 'new');--> statement-breakpoint
CREATE TYPE "item_kind" AS ENUM('card', 'sealed', 'game', 'hardware');--> statement-breakpoint
CREATE TYPE "price_source" AS ENUM('tcgcsv', 'pricecharting', 'manual');--> statement-breakpoint
CREATE TABLE "card_details" (
	"item_id" integer PRIMARY KEY,
	"category_id" integer NOT NULL,
	"group_id" integer NOT NULL,
	"tcgplayer_product_id" integer NOT NULL,
	"sub_type" text,
	"set_name" text NOT NULL,
	"number" text,
	"rarity" text,
	"image_url" text
);
--> statement-breakpoint
CREATE TABLE "game_details" (
	"item_id" integer PRIMARY KEY,
	"platform" text NOT NULL,
	"pricecharting_url" text,
	"variant" "game_variant" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" "item_kind" NOT NULL,
	"name" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"condition" text,
	"notes" text,
	"cost_basis_cents" bigint NOT NULL,
	"basis_source" "basis_source" NOT NULL,
	"acquired_date" date NOT NULL,
	"acquired_txn_id" integer NOT NULL,
	"sold_txn_id" integer,
	"sale_proceeds_cents" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_quantity_positive" CHECK ("quantity" > 0),
	CONSTRAINT "items_basis_nonnegative" CHECK ("cost_basis_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "price_snapshots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "price_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source" "price_source" NOT NULL,
	"external_id" text NOT NULL,
	"variant" text DEFAULT '' NOT NULL,
	"price_cents" bigint NOT NULL,
	"as_of" date NOT NULL,
	CONSTRAINT "price_snapshots_key" UNIQUE("source","external_id","variant","as_of")
);
--> statement-breakpoint
CREATE INDEX "card_details_group_idx" ON "card_details" ("category_id","group_id");--> statement-breakpoint
CREATE INDEX "items_acquired_txn_idx" ON "items" ("acquired_txn_id");--> statement-breakpoint
CREATE INDEX "items_sold_txn_idx" ON "items" ("sold_txn_id");--> statement-breakpoint
ALTER TABLE "card_details" ADD CONSTRAINT "card_details_item_id_items_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "game_details" ADD CONSTRAINT "game_details_item_id_items_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_acquired_txn_id_transactions_id_fkey" FOREIGN KEY ("acquired_txn_id") REFERENCES "transactions"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_sold_txn_id_transactions_id_fkey" FOREIGN KEY ("sold_txn_id") REFERENCES "transactions"("id") ON DELETE RESTRICT;