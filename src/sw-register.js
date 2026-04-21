import { registerSW } from "virtual:pwa-register";

registerSW({
  immediate: true,
  onOfflineReady() {
    console.info("Speed Alert is ready to work offline.");
  },
  onNeedRefresh() {
    console.info("New version available. Reload to update.");
  },
});
