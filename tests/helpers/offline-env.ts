// No test may reach a paid or personal account, even when the developer's shell or .env holds real credentials: every
// integration is switched off here, and the Mistral endpoint points at a local port nothing listens on. Tests that need
// an integration start a fake and pass its address explicitly.
export const OFFLINE_INTEGRATIONS_ENV: Record<string, string> = {
  AI_MODE: "mock",
  MISTRAL_API_KEY: "",
  MISTRAL_API_BASE_URL: "http://127.0.0.1:9",
  GOOGLE_OAUTH_CLIENT_ID: "",
  GOOGLE_OAUTH_CLIENT_SECRET: "",
  NOTEBOOKLM_PROFILE: "",
};
