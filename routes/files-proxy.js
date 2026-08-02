const express = require('express');
const path = require('path');

module.exports = function createFileProxyRouter({ fileService }) {
  const router = express.Router();

  router.get('/:objectKey(*)', async (req, res) => {
    try {
      const objectKey = fileService.getObjectKeyFromRequest(req);
      if (!objectKey) {
        return res.status(400).json({ error: 'Missing object key.' });
      }

      const resolvedKey = await fileService.resolveExistingObjectKey(objectKey);
      if (!resolvedKey) {
        return res.status(404).json({ error: 'File not found.' });
      }

      const response = await fileService.fetchFile(resolvedKey);
      if (!response || !response.Body) {
        return res.status(404).json({ error: 'File not found.' });
      }

      res.status(200);
      res.setHeader('Content-Type', response.ContentType || 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      res.setHeader('Content-Disposition', `inline; filename="${path.basename(resolvedKey)}"`);

      if (typeof response.Body.transformToByteArray === 'function') {
        const bytes = await response.Body.transformToByteArray();
        return res.end(Buffer.from(bytes));
      }

      if (typeof response.Body.pipe === 'function') {
        return response.Body.pipe(res);
      }

      return res.end(response.Body);
    } catch (error) {
      console.error('File fetch failed:', error);
      return res.status(500).json({ error: 'Failed to fetch file from Cloudflare R2.', details: error.message || String(error) });
    }
  });

  return router;
};
