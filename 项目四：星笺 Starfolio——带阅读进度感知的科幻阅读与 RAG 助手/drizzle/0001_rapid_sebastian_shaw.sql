CREATE TABLE "chapters" (
	"chapter_key" text PRIMARY KEY NOT NULL,
	"issue_work_key" text NOT NULL,
	"content_version" text NOT NULL,
	"title_as_printed" text NOT NULL,
	"order" integer NOT NULL,
	"node_kind" text NOT NULL,
	"source" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_issue_work_key_issue_works_issue_work_key_fk" FOREIGN KEY ("issue_work_key") REFERENCES "public"."issue_works"("issue_work_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_content_version_content_versions_content_version_fk" FOREIGN KEY ("content_version") REFERENCES "public"."content_versions"("content_version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chapters_issue_work_order_idx" ON "chapters" USING btree ("issue_work_key","order");