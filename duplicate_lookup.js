async function findMatchingDuplicateInDocs({
  docs,
  fileHash,
  currentFileId = '',
  fileBuffer,
  fileName = '',
  mimeType = '',
  getOrComputeFileHash,
}) {
  for (const doc of docs) {
    if ((currentFileId || '').toString().trim() === doc.id) {
      continue;
    }

    const data = doc.data ? doc.data() || {} : {};
    const candidateHash = data.fileHash || (await getOrComputeFileHash(doc));
    if (candidateHash && candidateHash === fileHash) {
      return doc;
    }

    if (fileBuffer && ['.txt', '.md', '.rtf', '.csv', '.json', '.xml', '.html', '.pdf'].some((ext) => (fileName || '').toLowerCase().endsWith(ext))) {
      const candidateTextFingerprint = typeof data.textFingerprint === 'string' ? data.textFingerprint : '';
      if (candidateTextFingerprint) {
        const currentTextFingerprint = require('./content_fingerprint').computeTextFingerprint(fileBuffer.toString('utf8'));
        if (currentTextFingerprint && currentTextFingerprint === candidateTextFingerprint) {
          return doc;
        }
      }
    }
  }

  return null;
}

module.exports = {
  findMatchingDuplicateInDocs,
};
