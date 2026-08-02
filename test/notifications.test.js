const test = require('node:test');
const assert = require('node:assert/strict');
const { createNotificationService } = require('../services/notifications');

test('resolveNotificationMetadata prefers explicit payload values', () => {
  const service = createNotificationService({});
  const metadata = service.resolveNotificationMetadata({
    data: { category: 'promo', notificationType: 'news', isImportant: 'true' },
    category: 'general',
    notificationType: 'admin_message',
    isImportant: 'false',
  });

  assert.equal(metadata.category, 'promo');
  assert.equal(metadata.notificationType, 'news');
  assert.equal(metadata.isImportant, true);
});

test('getLocalizedField falls back to base fields', () => {
  const service = createNotificationService({});
  const title = service.getLocalizedField({ title_en: 'Hello', title: 'Base title' }, 'title', 'fr');
  assert.equal(title, 'Base title');
});
