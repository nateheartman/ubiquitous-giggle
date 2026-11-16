/**
 * ThoughtNotes is fully local. Thought Desk's online features (sync, writing
 * together, friends, the account, the sponsor goal, its update feed) talk to
 * the upstream author's servers, so the interface hides them and never starts
 * their background work while this is false. The code stays in place, which
 * keeps later merges from upstream small.
 */
export const CLOUD_FEATURES = false;
