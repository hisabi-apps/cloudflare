const path = require('path');
require('dotenv').config({
  path: path.resolve(__dirname, '..', '.env'),
});

const admin = require('firebase-admin');
const { createSubjectStatsService } = require('./services/statsService');

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountJson) {
  console.error('❌ FIREBASE_SERVICE_ACCOUNT environment variable is not set.');
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(serviceAccountJson);
} catch (error) {
  console.error('❌ Failed to parse FIREBASE_SERVICE_ACCOUNT JSON:', error.message);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: serviceAccount.project_id,
});

const db = admin.firestore();
const cache = { flushAll() {} };
const USE_STATS_SHARDS = process.env.USE_STATS_SHARDS === 'true';
const STATS_SHARD_COUNT = Number.isInteger(Number(process.env.STATS_SHARD_COUNT))
  ? Number(process.env.STATS_SHARD_COUNT)
  : 10;
const subjectStatsService = createSubjectStatsService({
  admin,
  db,
  cache,
  useStatsShards: USE_STATS_SHARDS,
  statsShardCount: STATS_SHARD_COUNT,
});

(async () => {
  try {
    console.log('🔧 Rebuilding compact subject_stats docs from approved files...');

    const result = await subjectStatsService.rebuildSubjectStatsFromApprovedFiles({
      batchSize: 500,
      writeBatchSize: 400,
      deleteOldDocs: true,
    });

    console.log('🔧 Rebuilding app_metadata.subjects_index from compact subject_stats...');
    const indexResult = await subjectStatsService.rebuildSubjectsIndexFromSubjectStats({ batchSize: 500 });

    console.log('✅ subject_stats rebuild completed:', result);
    console.log('✅ subjects_index rebuild completed:', indexResult);
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to rebuild subject_stats docs:', error.message || error);
    process.exit(1);
  }
})();
