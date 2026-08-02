const { isAdminUserData } = require('../services/userService');

async function verifyAdminRequest(req, res, admin, db) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized request.' });
    return null;
  }

  const idToken = authHeader.split(' ')[1];
  let decodedToken;
  try {
    decodedToken = await admin.auth().verifyIdToken(idToken);
  } catch (error) {
    console.error('⚠️ Invalid auth token in admin request:', error);
    res.status(401).json({ error: 'Unauthorized request.' });
    return null;
  }

  const currentUid = decodedToken?.uid;
  if (!currentUid) {
    res.status(401).json({ error: 'Unauthorized request.' });
    return null;
  }

  const senderDoc = await db.collection('users').doc(currentUid).get();
  const senderEmail = decodedToken.email || '';
  const senderData = senderDoc.exists ? senderDoc.data() : null;

  if (!senderDoc.exists || !isAdminUserData(senderData, senderEmail)) {
    res.status(403).json({ error: 'Not authorized.' });
    return null;
  }

  return { uid: currentUid, userData: senderData };
}

module.exports = {
  verifyAdminRequest,
};
