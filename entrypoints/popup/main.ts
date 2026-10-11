// popup — runs inside the extension action popup
import { sendMessage } from "../../src/messaging"

const dot  = document.getElementById("statusDot")!
const text = document.getElementById("statusText")!
const cmd  = document.getElementById("statusCmd")!

function showCommand(command: string) {
  cmd.style.display = "block"
  cmd.textContent   = command
}

async function showStatus() {
  const status = await sendMessage({ type: "AI_STATUS" })
  switch (status?.state) {
    case "ready":
      dot.classList.add("green")
      text.textContent = "Ready · " + status.model
      break
    case "idle":
      dot.classList.add("green")
      text.textContent = "Ollama running · " + status.model + " (loads on first check)"
      break
    case "no-model":
      dot.classList.add("red")
      text.textContent = "No Gemma model found — run:"
      showCommand("ollama pull gemma3:4b")
      break
    default:
      dot.classList.add("red")
      text.textContent = "Ollama not detected — run:"
      showCommand("ollama serve")
  }
}

showStatus()
