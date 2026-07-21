function normalizeText(value) {
  return (value || '')
    .toString()
    .trim()
    .toLowerCase();
}

function buildExerciseFileDocument({
  subject,
  title,
  name,
  url,
  storagePath,
  uploadedByUid,
  uploadedByEmail,
  isApproved,
  reviewStatus,
  fileHash,
  textFingerprint,
  createdAt,
  optionalFields = {},
}) {
  const newFileDoc = {
    subject: subject.trim(),
    title: title.trim(),
    name,
    url,
    storagePath,
    storageType: 'cloudflare-r2',
    isApproved,
    reviewStatus,
    uploadedByUid,
    uploadedByEmail,
    fileHash,
    textFingerprint,
    createdAt,
  };

  for (const [field, value] of Object.entries(optionalFields)) {
    if (value === undefined || value === null) continue;
    const trimmedValue = value.toString().trim();
    if (!trimmedValue) continue;
    newFileDoc[field] = trimmedValue;
    if (field === 'specialty') {
      newFileDoc.specialtyNormalized = normalizeText(trimmedValue);
    }
  }

  return newFileDoc;
}

module.exports = {
  buildExerciseFileDocument,
};
