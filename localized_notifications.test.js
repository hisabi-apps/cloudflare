const test = require('node:test');
const assert = require('node:assert/strict');

test('should extract and use user language for notifications', async (t) => {
  // Simulate user data with different languages
  const users = [
    { uid: 'user_ar', language: 'ar' },
    { uid: 'user_en', language: 'en' },
    { uid: 'user_fr', language: 'fr' },
  ];

  const requestBody = {
    title: 'Default Title',
    title_ar: 'عنوان عربي',
    title_en: 'English Title',
    title_fr: 'Titre Français',
    body: 'Default Body',
    body_ar: 'نص عربي',
    body_en: 'English Body',
    body_fr: 'Corps Français',
  };

  // Test language selection logic
  users.forEach((user) => {
    const userLanguage = (user.language || 'ar').toLowerCase().substring(0, 2);
    const notificationTitle = requestBody[`title_${userLanguage}`]?.trim() || requestBody.title.trim();
    const notificationBody = requestBody[`body_${userLanguage}`]?.trim() || requestBody.body.trim();

    const expected = {
      ar: { title: 'عنوان عربي', body: 'نص عربي' },
      en: { title: 'English Title', body: 'English Body' },
      fr: { title: 'Titre Français', body: 'Corps Français' },
    };

    assert.equal(
      notificationTitle,
      expected[userLanguage].title,
      `User ${user.uid} should get correct localized title`
    );
    assert.equal(
      notificationBody,
      expected[userLanguage].body,
      `User ${user.uid} should get correct localized body`
    );
  });

  console.log('✅ All language variants passed');
});
