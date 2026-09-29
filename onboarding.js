// onboarding.js — single-page welcome screen

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btnStart").addEventListener("click", () => {
    chrome.storage.local.set({ onboardingDone: true }, () => {
      window.close()
    })
  })
})
