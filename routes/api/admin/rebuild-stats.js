const express = require('express');

module.exports = function createAdminRebuildStatsRouter({ verifyAdminRequest, rebuildSubjectStatsFromApprovedFiles, cache }) {
  const router = express.Router();

  router.post('/', async (req, res) => {
    try {
      const adminRequest = await verifyAdminRequest(req, res);
      if (!adminRequest) {
        return;
      }

      console.log('🔧 Manual admin rebuild-stats requested by', adminRequest.uid);

      const result = await rebuildSubjectStatsFromApprovedFiles({ batchSize: 500 });
      cache.flushAll();

      return res.json({
        success: true,
        manual: true,
        updated: result.statsDocs,
        processedFiles: result.processedFiles,
        pages: result.pages,
      });
    } catch (error) {
      console.error('Failed to rebuild subject_stats:', error);
      return res.status(500).json({ error: 'Failed to rebuild subject_stats.' });
    }
  });

  return router;
};