// Hidden page that runs Chrome's built-in AI for the background worker,
// which may not have the Prompt API itself (src/analysis/offscreen-host.ts).
import { serveOffscreen } from "../../src/analysis/offscreen-host"

serveOffscreen()
