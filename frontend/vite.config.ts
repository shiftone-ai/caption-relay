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
      name: "app-routes",
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          const url = new URL(request.url ?? "/", "http://localhost");
          if (url.pathname === "/view/demo") request.url = "/static/view.html" + url.search;
          if (url.pathname === "/" || /^\/rooms\/[a-z0-9-]{1,64}\/?$/.test(url.pathname)) request.url = "/static/index.html" + url.search;
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
