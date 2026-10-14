import { copyFileSync } from "node:fs";
copyFileSync("dist/index.html", "../src/nccn_nav/dashboard.html");
console.log("template -> src/nccn_nav/dashboard.html");
