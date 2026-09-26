import { createRouter, createWebHistory } from "vue-router";
import DriverIntentView from "./views/DriverIntentView.vue";
import HostDashboardView from "./views/HostDashboardView.vue";
import HostNodeFormView from "./views/HostNodeFormView.vue";
import HostNodeView from "./views/HostNodeView.vue";
import HomeView from "./views/HomeView.vue";
import IntentMatchesView from "./views/IntentMatchesView.vue";
import ProofView from "./views/ProofView.vue";
import ReservationView from "./views/ReservationView.vue";
import StartView from "./views/StartView.vue";

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior(to) {
    if (to.hash) return { el: to.hash, behavior: "smooth" };
    return { top: 0 };
  },
  routes: [
    { path: "/", component: HomeView },
    { path: "/host", component: HostDashboardView },
    { path: "/host/nodes/new", component: HostNodeFormView },
    { path: "/host/nodes/:nodeId", component: HostNodeView },
    { path: "/driver", component: DriverIntentView },
    { path: "/driver/intents/:intentId", component: IntentMatchesView },
    { path: "/driver/reservations/:id", component: ReservationView },
    { path: "/start", component: StartView },
    { path: "/reservations/:id/proof", component: ProofView },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});
