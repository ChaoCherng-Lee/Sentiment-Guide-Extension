// options — switch optional sites (Instagram, Gmail) on and off. Each one is
// an optional host permission; the background worker registers the site's
// content script when it's granted.
import { browser } from "#imports"
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
