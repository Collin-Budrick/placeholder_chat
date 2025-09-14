import { qwikify$ } from "@builder.io/qwik-react";
import StatsCard from "./preact/StatsCard";

// Hydrate when visible so it only runs once scrolled into view
export const PreactStatsIsland = qwikify$(StatsCard, {
	eagerness: "visible",
	clientOnly: true,
});
