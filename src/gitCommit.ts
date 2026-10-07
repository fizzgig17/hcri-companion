// src/gitCommit.ts
//
// Short git commit id this build was made from. 'local' in the repo; the dev
// workflow (deploy-dev.yml) overwrites this whole file with the real id just
// before building, the same way it rewrites hcri/apiConfig.ts. Only shown on
// dev builds (see VersionStamp.tsx).
export const GIT_COMMIT = 'local';
