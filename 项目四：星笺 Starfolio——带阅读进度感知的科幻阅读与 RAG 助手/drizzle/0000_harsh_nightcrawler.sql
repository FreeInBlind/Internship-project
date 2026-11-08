CREATE TABLE "content_blocks" (
	"block_key" text PRIMARY KEY NOT NULL,
	"issue_work_key" text NOT NULL,
	"content_version" text NOT NULL,
	"kind" text NOT NULL,
	"order" integer NOT NULL,
	"text" text NOT NULL,
	"content_hash" text NOT NULL,
	"chapter_key" text,
	"source" jsonb NOT NULL,
	"quality_status" text NOT NULL,
	"review_items" jsonb NOT NULL,
	"human_review_status" text
);
--> statement-breakpoint
CREATE TABLE "content_versions" (
	"content_version" text PRIMARY KEY NOT NULL,
	"issue_work_key" text NOT NULL,
	"source_file_sha256" text NOT NULL,
	"parser_version" text NOT NULL,
	"normalization_version" text NOT NULL,
	"coverage" text NOT NULL,
	"schema_version" text NOT NULL,
	"batch_key" text NOT NULL,
	"review" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"batch_key" text PRIMARY KEY NOT NULL,
	"schema_version" text NOT NULL,
	"candidate_sha256" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"review" jsonb NOT NULL,
	"record_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_works" (
	"issue_work_key" text PRIMARY KEY NOT NULL,
	"issue_key" text NOT NULL,
	"work_key" text NOT NULL,
	"title_as_printed" text NOT NULL,
	"author_as_printed" text,
	"translator_as_printed" text,
	"original_title_as_printed" text,
	"part_kind" text NOT NULL,
	"part_label_as_printed" text,
	"part_order" integer,
	"issue_order" integer,
	"sequence_key" text,
	"previous_issue_work_key" text,
	"next_issue_work_key" text,
	"coverage" text NOT NULL,
	"source_page_range" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"content_version" text NOT NULL,
	"quality_status" text NOT NULL,
	"review_items" jsonb NOT NULL,
	"human_review_status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"issue_key" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"published_month" text,
	"source_file" jsonb NOT NULL,
	"quality_status" text NOT NULL,
	"review_items" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "works" (
	"work_key" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"original_title_as_printed" text,
	"author_key" text,
	"identity_status" text NOT NULL,
	"quality_status" text NOT NULL,
	"review_items" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_blocks" ADD CONSTRAINT "content_blocks_issue_work_key_issue_works_issue_work_key_fk" FOREIGN KEY ("issue_work_key") REFERENCES "public"."issue_works"("issue_work_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_blocks" ADD CONSTRAINT "content_blocks_content_version_content_versions_content_version_fk" FOREIGN KEY ("content_version") REFERENCES "public"."content_versions"("content_version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_issue_work_key_issue_works_issue_work_key_fk" FOREIGN KEY ("issue_work_key") REFERENCES "public"."issue_works"("issue_work_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_works" ADD CONSTRAINT "issue_works_issue_key_issues_issue_key_fk" FOREIGN KEY ("issue_key") REFERENCES "public"."issues"("issue_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_works" ADD CONSTRAINT "issue_works_work_key_works_work_key_fk" FOREIGN KEY ("work_key") REFERENCES "public"."works"("work_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_blocks_version_order_uq" ON "content_blocks" USING btree ("content_version","order");--> statement-breakpoint
CREATE INDEX "content_blocks_issue_work_order_idx" ON "content_blocks" USING btree ("issue_work_key","order");--> statement-breakpoint
CREATE INDEX "content_versions_issue_work_idx" ON "content_versions" USING btree ("issue_work_key");--> statement-breakpoint
CREATE INDEX "issue_works_work_key_idx" ON "issue_works" USING btree ("work_key");