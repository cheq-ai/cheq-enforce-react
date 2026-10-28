// Publishing triggers on a version tag, but nothing else checks that the tag and the four
// version fields agree -- a stale field would silently republish the previous version.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const tag = (process.argv[2] ?? "").trim();
if (!tag) {
    console.error("usage: verify-version <tag>");
    process.exit(1);
}

const versions = [
    ["source/cheq-enforce-react/package.json", JSON.parse(readFileSync("source/cheq-enforce-react/package.json", "utf8")).version],
    ["package.json", JSON.parse(readFileSync("package.json", "utf8")).version],
    ["sample-app/enforce-react-demo/package.json", JSON.parse(readFileSync("sample-app/enforce-react-demo/package.json", "utf8")).version],
    // Derived from the demo's package.json; checked so a broken config surfaces here.
    ["sample-app/enforce-react-demo/app.config.js", require("../sample-app/enforce-react-demo/app.config.js").expo?.version],
];

const mismatched = versions.filter(([, version]) => version !== tag);

if (mismatched.length > 0) {
    console.error(`Tag is ${tag}, but these do not match:`);
    for (const [path, version] of mismatched) console.error(`  ${path}: ${version ?? "(missing)"}`);
    process.exit(1);
}

console.log(`All version fields match tag ${tag}`);
