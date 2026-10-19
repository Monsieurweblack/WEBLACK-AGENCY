/** Données de test fictives — utilisées uniquement par les tests unitaires, jamais envoyées à un environnement réel. */

export const TEST_PHOTO_IDS = {
  portrait: "11111111-1111-4111-8111-111111111111",
  profile: "22222222-2222-4222-8222-222222222222",
  fullLength: "33333333-3333-4333-8333-333333333333",
} as const;

export function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    lang: "fr",
    firstName: "Awa",
    lastName: "Diallo",
    birthDate: "2000-01-15",
    city: "Dakar",
    country: "SN",
    email: "awa@example.com",
    phone: "+221 77 000 00 00",
    category: "runway",
    experienceLevel: "beginner",
    experienceDuration: "none",
    portfolioLinks: [],
    heightCm: 178,
    photoIds: {
      portrait: [TEST_PHOTO_IDS.portrait],
      profile: [TEST_PHOTO_IDS.profile],
      full_length: [TEST_PHOTO_IDS.fullLength],
      extra: [],
    },
    languages: ["fr", "wo"],
    mobility: "international",
    desiredProjects: ["runway", "editorial"],
    accuracyConfirmed: true,
    privacyNoticeAccepted: true,
    privacyNoticeVersion: "2026-10-19",
    ...overrides,
  };
}
