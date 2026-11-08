import { createHash } from 'node:crypto';

const sha256 = /^[a-f0-9]{64}$/;

export function isWaivedReview(review, identity) {
  return !!review && review.project_acceptance === 'user_waived_sampling'
    && review.mode === 'user_waived_sampling' && review.result === 'not_reviewed'
    && review.authorized === true && review.full_text_verified === false
    && typeof review.user_reply === 'string' && review.user_reply.trim().length > 0
    && review.issue_work_key === identity.issueWorkKey && review.content_version === identity.contentVersion
    && review.accepted_versions?.[identity.issueWorkKey] === identity.contentVersion
    && review.accepted_scope === identity.coverage && review.source_file_sha256 === identity.sourceFileSha256
    && typeof review.machine_receipt_json === 'string'
    && (() => { try { return validMachineReceipt(review, JSON.parse(review.machine_receipt_json), createHash('sha256').update(review.machine_receipt_json).digest('hex')); } catch { return false; } })()
    && [review.content_version, review.source_file_sha256, review.source_records_sha256,
      review.candidate_records_sha256, review.machine_receipt_sha256, review.waiver_record_sha256].every((value) => typeof value === 'string' && sha256.test(value));
}

export function validMachineReceipt(review, receipt, receiptSha256) {
  return !!receipt && review.machine_receipt_sha256 === receiptSha256
    && receipt.validator === 'offline/validate_sample.py' && receipt.result?.status === 'passed'
    && receipt.result?.human_review === 'not_performed' && receipt.result?.records_match_reextraction === true
    && receipt.result?.raw_and_audit_match_reextraction === true
    && receipt.records_sha256 === review.source_records_sha256
    && [receipt.records_sha256, receipt.manifest_sha256, receipt.plan_sha256].every((value) => typeof value === 'string' && sha256.test(value));
}
