// Shared auth-conflict detection.
//
// An anonymous user upgrades by *linking* a Google identity (or adding an
// email) so their server-side progress carries over. If that identity/email
// already belongs to another Supabase user the upgrade fails and we must fall
// back to a plain sign-in into the existing account.
//
// Only fall back for that specific conflict. Any other error (manual linking
// disabled, network, server, expired session) must surface — otherwise we
// silently reintroduce the anon-progress-loss bug PR #93 fixed.

export const isIdentityConflict = (err) =>
  err?.code === "identity_already_exists" ||
  /identity (is )?already (linked|exists|in use)/i.test(err?.message ?? "");

export const isEmailConflict = (err) =>
  err?.code === "email_exists" ||
  err?.code === "user_already_exists" ||
  /email address (is )?already|user already registered|already (been )?registered/i.test(err?.message ?? "");

// For an OAuth provider, linkIdentity()/signInWithOAuth() redirect the browser
// before any conflict is known — the failure comes back asynchronously as URL
// params on the redirect (query string for PKCE, hash for implicit flow).
// Returns a normalized { code, message } shaped like a Supabase error so the
// helpers above apply unchanged, or null when there is no error param.
export const readOAuthErrorFromUrl = () => {
  if (typeof window === "undefined") return null;

  const fromSearch = new URLSearchParams(window.location.search || "");
  const fromHash = new URLSearchParams(
    (window.location.hash || "").replace(/^#/, ""),
  );
  const pick = (key) => fromSearch.get(key) ?? fromHash.get(key);

  const error = pick("error");
  const code = pick("error_code");
  if (!error && !code) return null;

  const description = pick("error_description");
  return {
    code: code ?? error,
    message: description ? decodeURIComponent(description.replace(/\+/g, " ")) : (error ?? ""),
  };
};
