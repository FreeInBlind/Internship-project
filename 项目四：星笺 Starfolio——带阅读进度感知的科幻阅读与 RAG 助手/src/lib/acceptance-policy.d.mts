export function isWaivedReview(review: Record<string, any> | null | undefined, identity: { issueWorkKey: string; contentVersion: string; coverage: string; sourceFileSha256: string }): boolean;
export function validMachineReceipt(review: Record<string, any>, receipt: Record<string, any>, receiptSha256: string): boolean;
