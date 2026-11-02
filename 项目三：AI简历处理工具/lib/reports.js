import { prisma } from './db';
import core from './reports.cjs';
import { validateSaveReportInput, validateReportPatch } from './reportPersistence';

export const REPORT_TTL_MS = core.REPORT_TTL_MS;
export const ReportError = core.ReportError;
export const reportVersion = core.reportVersion;
export const reportDTO = core.reportDTO;
export const reportMetadata = core.reportMetadata;
export const createReportRepository = core.createReportRepository;
const repository = createReportRepository(prisma, { validateSave: validateSaveReportInput, validatePatch: validateReportPatch });
export const createSavedReport = repository.createSavedReport;
export const getActiveSavedReport = repository.getActiveSavedReport;
export const updateSavedReport = repository.updateSavedReport;
export const deleteSavedReport = repository.deleteSavedReport;
export const listSavedReports = repository.listSavedReports;
export const cleanupExpiredReports = repository.cleanupExpiredReports;
