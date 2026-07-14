const test = require('node:test');
const assert = require('node:assert/strict');
const { buildNotificationMessagePayload } = require('./notification_payload');

test('buildNotificationMessagePayload includes notification block and localized data', () => {
  const payload = buildNotificationMessagePayload({
    title: 'Bonjour',
    body: 'Vous avez une nouvelle notification',
    localizedTitleEntries: [['title_ar', 'مرحبا'], ['title_en', 'Hello'], ['title_fr', 'Bonjour']],
    localizedBodyEntries: [['body_ar', 'لديك إشعار جديد'], ['body_en', 'You have a new notification'], ['body_fr', 'Vous avez une nouvelle notification']],
    sanitizedData: {
      notificationType: 'admin_message',
      target: 'all',
    },
    attachmentImageUrl: '',
    notificationIconUrl: '',
  });

  assert.equal(payload.notification.title, 'Bonjour');
  assert.equal(payload.notification.body, 'Vous avez une nouvelle notification');
  assert.equal(payload.data.title_ar, 'مرحبا');
  assert.equal(payload.data.body_en, 'You have a new notification');
  assert.equal(payload.data.notificationType, 'admin_message');
});
