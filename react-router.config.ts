import type { Config } from "@react-router/dev/config";

export default {
  // Disable SSR for Electron - we need SPA mode
  ssr: false,
  // Use hash-based routing for Electron file:// protocol
  basename: "/",
} satisfies Config;
