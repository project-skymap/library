import fs from "fs";
import path from "path";
import { bibleToSceneModel } from "../src/adapters/bible";
import { computeSphericalArrangement } from "../src/arrangement/strategies/spherical";
import type { BibleJSON } from "../src/adapters/bible";

async function main() {
    console.log("Generating arrangement.json for builder...");

    // 1. Read Bible Data from Builder
    const biblePath = path.resolve(process.cwd(), "../builder/public/bible.json");
    if (!fs.existsSync(biblePath)) {
        console.error(`Error: Could not find bible.json at ${biblePath}`);
        process.exit(1);
    }
    const bibleData = JSON.parse(fs.readFileSync(biblePath, "utf-8")) as BibleJSON;

    // 2. Convert to Model
    const model = bibleToSceneModel(bibleData);
    console.log(`Model created with ${model.nodes.length} nodes.`);

    // 3. Compute spherical arrangement (matches engine default)
    const { arrangement } = computeSphericalArrangement(model, { radius: 2000 });

    const count = Object.keys(arrangement).length;

    // 4. Write to builder/app/arrangement.json
    const outPath = path.resolve(process.cwd(), "../builder/app/arrangement.json");
    fs.writeFileSync(outPath, JSON.stringify(arrangement, null, 2));

    console.log(`Success! Generated arrangement for ${count} nodes.`);
    console.log(`Written to ${outPath}`);
}

main().catch(console.error);
