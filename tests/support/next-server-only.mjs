// Let Node tests resolve Next's bundled marker using its React-server export.
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const nextCompiledModules = fileURLToPath(
  new URL("../../node_modules/next/dist/compiled/", import.meta.url),
);
process.env.NODE_PATH = [nextCompiledModules, process.env.NODE_PATH]
  .filter(Boolean)
  .join(path.delimiter);
Module._initPaths();
