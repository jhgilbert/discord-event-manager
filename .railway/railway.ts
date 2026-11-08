import { defineRailway, github, project, service, volume } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "discord-event-manager";
export default defineRailway(() => {
  // Holds the SQLite database (DATABASE_PATH=/data/events.db). Declared here so
  // that applying this file keeps it attached; leaving it out detaches it.
  const database = volume("discord-event-manager-volume", { sizeMB: 500, region: "sfo" });

  const discordEventManager = service("discord-event-manager", {
    source: github("jhgilbert/discord-event-manager", { branch: "main", checkSuites: false }),
    build: { buildCommand: "npm run build", buildEnvironment: "V3", builder: "NIXPACKS" },
    // `node` directly rather than `npm start`, so the stop signal reaches the
    // bot and it closes the database cleanly on redeploy.
    start: "node dist/index.js",
    // One replica only: two bots would answer every click twice and fight over
    // the same database file.
    replicas: { "sfo": 1 },
    // No restart policy: Railway's default (on failure, up to 10 times) is what
    // this bot wants, and Railway stores it as unset, so declaring it here only
    // shows up as a change on every plan.
    volumeMounts: { "/data": database },
  });

  return project("adaptable-balance", {
    variables: { managed: false },
    resources: [database, discordEventManager],
  });
});
