// options — switch optional sites (Instagram, Gmail) on and off. Each one is
// an optional host permission; the background worker registers the site's
// content script when it's granted.
import { browser } from "#imports"
import { sendMessage } from "../../src/messaging"
import { OPTIONAL_SITES, type OptionalSite } from "../../src/platforms/sites"

const list   = document.getElementById("sites")!
const status = document.getElementById("status")!

function row(site: OptionalSite): HTMLElement {
  const el = document.createElement("div")
  el.className = "site"
  el.innerHTML = `
    <div><h2></h2><p></p></div>
    <label class="switch"><input type="checkbox" /><span class="slider"></span></label>`
  el.querySelector("h2")!.textContent = site.name
  el.querySelector("p")!.textContent  = site.description
  const input = el.querySelector("input")!
  input.id = "site-" + site.id
  input.setAttribute("aria-label", `Check messages on ${site.name}`)

  browser.permissions.contains({ origins: site.origins }).then(on => { input.checked = on })

  input.addEventListener("change", async () => {
    status.textContent = ""
    try {
      // Must run straight from the click: Chrome only shows the prompt for a user gesture
      const ok = input.checked
        ? await browser.permissions.request({ origins: site.origins })
        : await browser.permissions.remove({ origins: site.origins })
      if (!ok) status.textContent = input.checked ? `${site.name} wasn't allowed, so it stays off.` : `Couldn't switch ${site.name} off.`
    } catch (err) {
      status.textContent = (err as Error).message
    }
    input.checked = await browser.permissions.contains({ origins: site.origins })
  })
  return el
}

list.replaceChildren(...OPTIONAL_SITES.map(row))

// ── Share with a parent ─────────────────────────────────────────────────────

const PAIR_ERRORS = {
  invalid:        "That code didn't work. Codes last 15 minutes and work once — ask for a new one.",
  too_many:       "Too many tries. Wait an hour, then ask for a new code.",
  not_configured: "Sharing isn't set up in this version of the extension.",
  error:          "Couldn't reach the server. Check your internet connection and try again.",
}

async function renderSharing() {
  const status = await sendMessage({ type: "SHARING_STATUS" })
  document.getElementById("sharing")!.hidden    = !status?.configured
  document.getElementById("sharingOff")!.hidden = !!status?.paired
  document.getElementById("sharingOn")!.hidden  = !status?.paired
}

// Pairing only unlocks once the child has read what's shared and agreed
document.getElementById("consent")!.addEventListener("change", e => {
  const agreed = (e.target as HTMLInputElement).checked
  ;(document.getElementById("pairCode") as HTMLInputElement).disabled = !agreed
  ;(document.getElementById("pairBtn") as HTMLButtonElement).disabled = !agreed
})

document.getElementById("unlinkBtn")!.addEventListener("click", async () => {
  if (!confirm("Stop sharing with your parent and delete everything that was shared?")) return
  const out = document.getElementById("unlinkStatus")!
  out.textContent = "Deleting…"
  const ok = await sendMessage({ type: "UNLINK_AND_DELETE" })
  out.textContent = ok ? "" : "Couldn't reach the server, so nothing was deleted yet. Try again when you're online."
  renderSharing()
})

document.getElementById("pairBtn")!.addEventListener("click", async () => {
  const input = document.getElementById("pairCode") as HTMLInputElement
  const out   = document.getElementById("pairStatus")!
  out.textContent = "Linking…"
  const result = await sendMessage({ type: "PAIR", code: input.value.trim() })
  out.textContent = !result || result === "ok" ? "" : PAIR_ERRORS[result]
  renderSharing()
})

renderSharing()
