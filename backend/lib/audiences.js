// Canonical audience whitelist for the backend HTTP surface.
//
// Mirrors azure-functions/lib/geo.js → AUDIENCES (the pipeline's source of
// truth). Kept as a single backend-side constant so /api/questions and
// /api/admin/generate-daily can't drift on which audiences are valid.
export const VALID_AUDIENCES = ["india", "global"];
