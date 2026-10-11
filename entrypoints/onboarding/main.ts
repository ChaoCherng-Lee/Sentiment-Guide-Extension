// onboarding — single-page welcome screen
import { browser } from "#imports"

document.getElementById("btnStart")!.addEventListener("click", async () => {
  await browser.storage.local.set({ onboardingDone: true })
  window.close()
})
