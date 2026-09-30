// The recommended settings profile and its stamp. apply-settings writes the
// stamp into `env.DOTCLAUDE_SETTINGS_PROFILE`; session start compares it with
// the shipped profile, so any profile change reads as out of date until it is
// applied again, without a check per release.

import fs from "node:fs";
import path from "node:path";

export const RECOMMENDED = path.resolve(
  import.meta.dir,
  "../../skills/apply-settings-profile/profiles/recommended.json",
);

/** Switches applied with the profile unless the user skips them. */
export const OPTIONAL = path.join(path.dirname(RECOMMENDED), "optional.json");

export const STAMP_KEY = "DOTCLAUDE_SETTINGS_PROFILE";

/**
 * First 12 hex digits of the SHA-256 of the profile file, plus the optional
 * switches when the profile is the shipped one. Which switches the user
 * skipped does not change the stamp; a change to the shipped files does.
 */
export function profileStamp(file = RECOMMENDED) {
  const hash = new Bun.CryptoHasher("sha256").update(fs.readFileSync(file));
  if (path.resolve(file) === RECOMMENDED)
    hash.update(fs.readFileSync(OPTIONAL));
  return hash.digest("hex").slice(0, 12);
}
