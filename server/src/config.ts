// Env reads in one place; boot refuses without the essentials.
const required = ['DATABASE_URL', 'GTWY_ORG_ID', 'GTWY_FOLDER_ID', 'GTWY_ACCESS_KEY'] as const;
for (const key of required) if (!process.env[key]) throw new Error(`Missing env ${key}`);

export const config = {
  port: Number(process.env.PORT || 4001),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:4000').split(',').map((s) => s.trim()),
  databaseUrl: process.env.DATABASE_URL!,
  gtwy: {
    orgId: process.env.GTWY_ORG_ID!,
    folderId: process.env.GTWY_FOLDER_ID!,
    accessKey: process.env.GTWY_ACCESS_KEY!,
    dbBaseUrl: (process.env.GTWY_DB_BASE_URL || 'https://db.gtwy.ai').replace(/\/+$/, ''),
    service: process.env.GTWY_SERVICE || 'openai',
    model: process.env.GTWY_MODEL || 'gpt-6-luna',
    embedUserId: 'workflows-poc',
  },
  remindAfterSec: Number(process.env.REMIND_AFTER_SEC || 120),
  expireAfterSec: Number(process.env.EXPIRE_AFTER_SEC || 600),
  approvalTimeoutSec: Number(process.env.APPROVAL_TIMEOUT_SEC || 1800),
  maxSteps: 15,
  maxDepth: 2,
  maxVisits: 100, // Go to step: most times a target may run
};
