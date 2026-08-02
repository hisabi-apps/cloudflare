function normalizeText(value) {
  return value
    .toString()
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizeStatsFilterValue(value) {
  const raw = value == null ? '' : value.toString().trim();
  return raw.length > 0 ? normalizeText(raw) : 'all';
}

function buildSubjectStatsDocId({ subject, year, state, specialty, fileYear }) {
  const normalized = {
    subject: normalizeText(subject || 'عام'),
    year: normalizeStatsFilterValue(year),
    state: normalizeStatsFilterValue(state),
    specialty: normalizeStatsFilterValue(specialty),
    fileYear: normalizeStatsFilterValue(fileYear),
  };

  return [
    `subject_${normalized.subject}`,
    `year_${normalized.year}`,
    `state_${normalized.state}`,
    `specialty_${normalized.specialty}`,
    `fileYear_${normalized.fileYear}`,
  ].join('|');
}

module.exports = {
  normalizeText,
  normalizeStatsFilterValue,
  buildSubjectStatsDocId,
};
