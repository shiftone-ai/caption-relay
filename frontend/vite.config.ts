import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const backendTarget = process.env.CAPTION_RELAY_API_URL ?? "http://127.0.0.1:24681";

export default defineConfig({
  base: "/static/",
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "audience-route",
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          if (request.url === "/view/demo") request.url = "/static/view.html";
          next();
        });
      },
    },
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host: "127.0.0.1", port: 24682, strictPort: true,
    proxy: { "/api": { target: backendTarget, ws: true }, "/closedcaption": { target: backendTarget } },
  },
  build: {
    rolldownOptions: {
      input: {
        operator: fileURLToPath(new URL("./index.html", import.meta.url)),
        audience: fileURLToPath(new URL("./view.html", import.meta.url)),
      },
    },
  },
});
