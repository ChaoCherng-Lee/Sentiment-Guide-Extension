import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// A static site: `npm run build` writes dist/, which any static host serves
export default defineConfig({
  plugins: [react()],
})
