const { PrismaClient } = require('@prisma/client');
const globalForPrisma = globalThis;
const prisma = globalForPrisma.__resumeWorkspacePrisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.__resumeWorkspacePrisma = prisma;
module.exports = { prisma };
