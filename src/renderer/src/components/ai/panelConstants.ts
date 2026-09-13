export const STORAGE_KEY_ACTIVE_SKILL = 'checkpoint_ai_active_skill'

// Dedicated stream channel. Keeps this panel's stream isolated from other
// consumers (e.g. the Standup Translator) so both can run concurrently.
export const ASSISTANT_STREAM_ID = 'assistant'
