// onboarding — single-page welcome screen
import { browser } from "#imports"
import { updateSettings } from "../../src/settings/store"

document.getElementById("btnStart")!.addEventListener("click", async () => {
  const incoming = (document.getElementById("incomingAnalysis") as HTMLInputElement).checked
  await updateSettings({ incomingAnalysis: incoming })
  await browser.storage.local.set({ onboardingDone: true })
  window.close()
})
