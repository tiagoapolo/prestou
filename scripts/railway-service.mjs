import { spawn } from "node:child_process";

const phase = process.argv[2];
const configuredService =
  process.env.PRESTOU_RAILWAY_SERVICE ?? process.env.RAILWAY_SERVICE_NAME ?? "";

const serviceAliases = new Map([
  ["@prestou/api", "api"],
  ["prestou-api", "api"],
  ["api", "api"],
  ["@prestou/web", "web"],
  ["prestou-web", "web"],
  ["web", "web"],
]);

if (phase !== "build" && phase !== "start") {
  console.error("Uso: node scripts/railway-service.mjs <build|start>");
  process.exit(1);
}

const service = serviceAliases.get(configuredService.trim().toLowerCase());

if (!service) {
  console.error(
    `Serviço Railway desconhecido: "${configuredService || "(ausente)"}". ` +
      "Mantenha RAILWAY_SERVICE_NAME como @prestou/api ou @prestou/web, " +
      "ou defina PRESTOU_RAILWAY_SERVICE como api ou web.",
  );
  process.exit(1);
}

const workspace = `@prestou/${service}`;
const isBuild = phase === "build";
const command = isBuild
  ? process.platform === "win32"
    ? "pnpm.cmd"
    : "pnpm"
  : process.execPath;
const args = isBuild
  ? ["--filter", service === "api" ? `${workspace}...` : workspace, "build"]
  : service === "api"
    ? ["apps/api/dist/server.js"]
    : [
        "apps/web/node_modules/serve/build/main.js",
        "-s",
        "apps/web/dist",
        "-l",
        `tcp://0.0.0.0:${process.env.PORT ?? "3000"}`,
      ];

console.log(`[railway] ${phase} do serviço ${configuredService} via ${workspace}`);

const child = spawn(command, args, {
  env: process.env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}

child.once("error", (error) => {
  console.error(`[railway] Falha ao executar ${phase}: ${error.message}`);
  process.exit(1);
});

child.once("exit", (code) => {
  process.exit(code ?? 1);
});
