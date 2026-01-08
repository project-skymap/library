import fs from "fs";
import path from "path";
import { bibleToSceneModel } from "../src/adapters/bible";
import { computeLayoutPositions } from "../src/engine/layout";
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

    // 3. Compute Layout
    // Matches the engine defaults
    const layoutConfig = {
        mode: "spherical" as const,
        radius: 2000,
        chapterRingSpacing: 15
    };

    const laidOutModel = computeLayoutPositions(model, layoutConfig);

    // 4. Extract Arrangement
    // Format: Record<string, { position: [x, y, z] }>
    const arrangement: Record<string, { position: [number, number, number] }> = {};

    let count = 0;
    for (const node of laidOutModel.nodes) {
        const x = (node.meta as any).x;
        const y = (node.meta as any).y;
        const z = (node.meta as any).z;

        if (typeof x === "number" && typeof y === "number" && typeof z === "number") {
            arrangement[node.id] = {
                position: [x, y, z]
            };
            count++;
        }
    }

    // 5. Write to builder/app/arrangement.json
    const outPath = path.resolve(process.cwd(), "../builder/app/arrangement.json");
    fs.writeFileSync(outPath, JSON.stringify(arrangement, null, 2));

    console.log(`Success! Generated arrangement for ${count} nodes.`);
    console.log(`Written to ${outPath}`);
}

main().catch(console.error);
