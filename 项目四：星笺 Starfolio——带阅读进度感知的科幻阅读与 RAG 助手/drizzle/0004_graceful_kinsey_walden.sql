CREATE TABLE "rag_chunks" (
	"run_key" text NOT NULL,
	"chunk_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"work_key" text NOT NULL,
	"issue_work_key" text NOT NULL,
	"content_version" text NOT NULL,
	"block_key" text NOT NULL,
	"block_order" integer NOT NULL,
	"coverage" text NOT NULL,
	"span_start" integer NOT NULL,
	"span_end" integer NOT NULL,
	"block_text_hash" text NOT NULL,
	"chunk_text_hash" text NOT NULL,
	"token_count" integer NOT NULL,
	"embedding_state" text NOT NULL,
	"upsert_state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rag_chunks_span_check" CHECK ("rag_chunks"."span_start" >= 0 AND "rag_chunks"."span_end" > "rag_chunks"."span_start"),
	CONSTRAINT "rag_chunks_token_count_check" CHECK ("rag_chunks"."token_count" > 0),
	CONSTRAINT "rag_chunks_embedding_state_check" CHECK ("rag_chunks"."embedding_state" IN ('pending', 'confirmed')),
	CONSTRAINT "rag_chunks_upsert_state_check" CHECK ("rag_chunks"."upsert_state" IN ('pending', 'confirmed'))
);
--> statement-breakpoint
CREATE TABLE "rag_index_runs" (
	"run_key" text PRIMARY KEY NOT NULL,
	"corpus_hash" text NOT NULL,
	"config_fingerprint" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"dimensions" integer NOT NULL,
	"chunker_version" text NOT NULL,
	"preprocessing_version" text NOT NULL,
	"token_budget" integer NOT NULL,
	"index_name" text NOT NULL,
	"target_host" text NOT NULL,
	"namespace" text NOT NULL,
	"phase" text NOT NULL,
	"expected_count" integer NOT NULL,
	"embedded_count" integer NOT NULL,
	"upserted_count" integer NOT NULL,
	"checkpoint" jsonb NOT NULL,
	"verification_summary" jsonb,
	"verification_time" timestamp with time zone,
	"error_code" text,
	"resume_phase" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rag_chunks" ADD CONSTRAINT "rag_chunks_run_key_rag_index_runs_run_key_fk" FOREIGN KEY ("run_key") REFERENCES "public"."rag_index_runs"("run_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_chunks" ADD CONSTRAINT "rag_chunks_issue_work_key_issue_works_issue_work_key_fk" FOREIGN KEY ("issue_work_key") REFERENCES "public"."issue_works"("issue_work_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_chunks" ADD CONSTRAINT "rag_chunks_content_version_content_versions_content_version_fk" FOREIGN KEY ("content_version") REFERENCES "public"."content_versions"("content_version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_chunks" ADD CONSTRAINT "rag_chunks_block_key_content_blocks_block_key_fk" FOREIGN KEY ("block_key") REFERENCES "public"."content_blocks"("block_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rag_chunks_run_chunk_uq" ON "rag_chunks" USING btree ("run_key","chunk_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rag_chunks_run_ordinal_uq" ON "rag_chunks" USING btree ("run_key","ordinal");--> statement-breakpoint
CREATE INDEX "rag_chunks_run_part_order_idx" ON "rag_chunks" USING btree ("run_key","issue_work_key","block_order");