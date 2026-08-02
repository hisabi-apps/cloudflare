const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveNotificationMetadata } = require('../index');

test('uses nested data category and type when the payload is sent through the admin request wrapper', () => {
  const requestBody = {
    title: 'Test title',
    body: 'Test body',
    data: {
      category: 'alert',
      notificationType: 'admin_message',
      isImportant: true,
    },
  };

  const metadata = resolveNotificationMetadata(requestBody);

  assert.equal(metadata.category, 'alert');
  assert.equal(metadata.notificationType, 'admin_message');
  assert.equal(metadata.isImportant, true);
});

test('falls back to top-level values when nested data is not provided', () => {
  const requestBody = {
    category: 'info',
    isImportant: false,
    notificationType: 'file_moderation',
  };

  const metadata = resolveNotificationMetadata(requestBody);

  assert.equal(metadata.category, 'info');
  assert.equal(metadata.notificationType, 'file_moderation');
  assert.equal(metadata.isImportant, false);
});

test('parses string boolean values for the important flag', () => {
  const requestBody = {
    data: {
      isImportant: 'false',
    },
  };

  const metadata = resolveNotificationMetadata(requestBody);

  assert.equal(metadata.isImportant, false);
});
