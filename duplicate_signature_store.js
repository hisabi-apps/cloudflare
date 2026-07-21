async function findDuplicateBySignatureStore({
  fileHash,
  currentFileId = '',
  getSignatureDoc,
  getFileDoc,
}) {
  if (!fileHash) {
    return null;
  }

  const signatureDoc = await getSignatureDoc(fileHash);
  if (!signatureDoc || !signatureDoc.exists) {
    return null;
  }

  const signatureData = typeof signatureDoc.data === 'function'
    ? signatureDoc.data() || {}
    : signatureDoc.data || {};

  const relatedFileIds = Array.isArray(signatureData.relatedFileIds)
    ? signatureData.relatedFileIds
    : [];

  for (const relatedId of relatedFileIds) {
    const normalizedId = (relatedId || '').toString().trim();
    if (!normalizedId) {
      continue;
    }

    if ((currentFileId || '').toString().trim() === normalizedId) {
      continue;
    }

    const fileDoc = await getFileDoc(normalizedId);
    if (!fileDoc || !fileDoc.exists) {
      continue;
    }

    return fileDoc;
  }

  return null;
}

module.exports = {
  findDuplicateBySignatureStore,
};
