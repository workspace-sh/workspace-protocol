// Copy the release build to native/actions.<platform>-<arch>.node, the name
// Node loads it by.
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const lib = { linux: "libworkspace_actions_node.so", darwin: "libworkspace_actions_node.dylib" }[
  process.platform
];
if (!lib) throw new Error(`no build for ${process.platform}`);
const root = fileURLToPath(new URL("..", import.meta.url));
mkdirSync(`${root}native`, { recursive: true });
copyFileSync(
  `${root}target/release/${lib}`,
  `${root}native/actions.${process.platform}-${process.arch}.node`,
);
