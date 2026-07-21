function shouldBlockDuplicateUpload({
  existingUploadedByUid,
  currentUploadedByUid,
}) {
  const existingUid = (existingUploadedByUid || '').toString().trim();
  const currentUid = (currentUploadedByUid || '').toString().trim();

  if (!existingUid || !currentUid) {
    return false;
  }

  return existingUid === currentUid;
}

module.exports = {
  shouldBlockDuplicateUpload,
};
