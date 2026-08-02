function isAdminUserData(userData, email) {
  if (!userData) {
    return false;
  }

  const normalizedEmail = (email || '').trim().toLowerCase();
  if (
    normalizedEmail.includes('admin') ||
    normalizedEmail.includes('owner') ||
    normalizedEmail.includes('moderator')
  ) {
    return true;
  }

  const roleValue = userData.role;
  if (typeof roleValue === 'string') {
    const normalizedRole = roleValue.trim().toLowerCase();
    if (
      normalizedRole.includes('admin') ||
      normalizedRole.includes('owner') ||
      normalizedRole.includes('moderator')
    ) {
      return true;
    }
  }

  if (typeof userData.isAdmin === 'boolean' && userData.isAdmin) {
    return true;
  }

  if (typeof userData.isAdmin === 'string' && userData.isAdmin.trim().toLowerCase() === 'true') {
    return true;
  }

  return false;
}

module.exports = {
  isAdminUserData,
};
