import { VueQueryPlugin } from "@tanstack/vue-query";
import { WagmiPlugin } from "@wagmi/vue";
import { createApp } from "vue";
import App from "./App.vue";
import { wagmiConfig } from "./lib/wagmi";
import { router } from "./router";
import "./style.css";

createApp(App)
  .use(router)
  .use(WagmiPlugin, { config: wagmiConfig })
  .use(VueQueryPlugin)
  .mount("#app");
