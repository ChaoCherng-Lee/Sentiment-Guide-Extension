// Which build this is (Plan 11.1). Set at build time with BUILD_EDITION:
//   - consumer (default): for adults; no parent pairing or sharing code at all
//   - family: adds pairing with a parent and sharing counts with them
// A constant the bundler folds, so `if (FAMILY)` code is left out of consumer builds.

declare const __EDITION__: "consumer" | "family" | undefined

export type Edition = "consumer" | "family"

// Unit tests have no build step: they run as the family edition (everything in)
export const EDITION: Edition = typeof __EDITION__ !== "undefined" && __EDITION__ ? __EDITION__ : "family"

export const FAMILY = EDITION === "family"
