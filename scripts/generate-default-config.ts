import fs from "fs";
import path from "path";
import { bibleToSceneModel } from "../src/adapters/bible";
import { computeLayoutPositions } from "../src/engine/layout";
import type { BibleJSON } from "../src/adapters/bible";

// Minimal Bible Data (Protestant Canon)
const DATA: BibleJSON = {
    testaments: [
        {
            name: "Old Testament",
            divisions: [
                {
                    name: "Pentateuch",
                    books: [
                        { key: "GEN", name: "Genesis", chapters: 50 },
                        { key: "EXO", name: "Exodus", chapters: 40 },
                        { key: "LEV", name: "Leviticus", chapters: 27 },
                        { key: "NUM", name: "Numbers", chapters: 36 },
                        { key: "DEU", name: "Deuteronomy", chapters: 34 }
                    ]
                },
                {
                    name: "History",
                    books: [
                        { key: "JOS", name: "Joshua", chapters: 24 },
                        { key: "JDG", name: "Judges", chapters: 21 },
                        { key: "RUT", name: "Ruth", chapters: 4 },
                        { key: "1SA", name: "1 Samuel", chapters: 31 },
                        { key: "2SA", name: "2 Samuel", chapters: 24 },
                        { key: "1KI", name: "1 Kings", chapters: 22 },
                        { key: "2KI", name: "2 Kings", chapters: 25 },
                        { key: "1CH", name: "1 Chronicles", chapters: 29 },
                        { key: "2CH", name: "2 Chronicles", chapters: 36 },
                        { key: "EZR", name: "Ezra", chapters: 10 },
                        { key: "NEH", name: "Nehemiah", chapters: 13 },
                        { key: "EST", name: "Esther", chapters: 10 }
                    ]
                },
                {
                    name: "Poetry",
                    books: [
                        { key: "JOB", name: "Job", chapters: 42 },
                        { key: "PSA", name: "Psalms", chapters: 150 },
                        { key: "PRO", name: "Proverbs", chapters: 31 },
                        { key: "ECC", name: "Ecclesiastes", chapters: 12 },
                        { key: "SNG", name: "Song of Solomon", chapters: 8 }
                    ]
                },
                {
                    name: "Major Prophets",
                    books: [
                        { key: "ISA", name: "Isaiah", chapters: 66 },
                        { key: "JER", name: "Jeremiah", chapters: 52 },
                        { key: "LAM", name: "Lamentations", chapters: 5 },
                        { key: "EZK", name: "Ezekiel", chapters: 48 },
                        { key: "DAN", name: "Daniel", chapters: 12 }
                    ]
                },
                {
                    name: "Minor Prophets",
                    books: [
                        { key: "HOS", name: "Hosea", chapters: 14 },
                        { key: "JOL", name: "Joel", chapters: 3 },
                        { key: "AMO", name: "Amos", chapters: 9 },
                        { key: "OBA", name: "Obadiah", chapters: 1 },
                        { key: "JON", name: "Jonah", chapters: 4 },
                        { key: "MIC", name: "Micah", chapters: 7 },
                        { key: "NAM", name: "Nahum", chapters: 3 },
                        { key: "HAB", name: "Habakkuk", chapters: 3 },
                        { key: "ZEP", name: "Zephaniah", chapters: 3 },
                        { key: "HAG", name: "Haggai", chapters: 2 },
                        { key: "ZEC", name: "Zechariah", chapters: 14 },
                        { key: "MAL", name: "Malachi", chapters: 4 }
                    ]
                }
            ]
        },
        {
            name: "New Testament",
            divisions: [
                {
                    name: "Gospels",
                    books: [
                        { key: "MAT", name: "Matthew", chapters: 28 },
                        { key: "MRK", name: "Mark", chapters: 16 },
                        { key: "LUK", name: "Luke", chapters: 24 },
                        { key: "JHN", name: "John", chapters: 21 }
                    ]
                },
                {
                    name: "History",
                    books: [
                        { key: "ACT", name: "Acts", chapters: 28 }
                    ]
                },
                {
                    name: "Pauline Epistles",
                    books: [
                        { key: "ROM", name: "Romans", chapters: 16 },
                        { key: "1CO", name: "1 Corinthians", chapters: 16 },
                        { key: "2CO", name: "2 Corinthians", chapters: 13 },
                        { key: "GAL", name: "Galatians", chapters: 6 },
                        { key: "EPH", name: "Ephesians", chapters: 6 },
                        { key: "PHP", name: "Philippians", chapters: 4 },
                        { key: "COL", name: "Colossians", chapters: 4 },
                        { key: "1TH", name: "1 Thessalonians", chapters: 5 },
                        { key: "2TH", name: "2 Thessalonians", chapters: 3 },
                        { key: "1TI", name: "1 Timothy", chapters: 6 },
                        { key: "2TI", name: "2 Timothy", chapters: 4 },
                        { key: "TIT", name: "Titus", chapters: 3 },
                        { key: "PHM", name: "Philemon", chapters: 1 }
                    ]
                },
                {
                    name: "General Epistles",
                    books: [
                        { key: "HEB", name: "Hebrews", chapters: 13 },
                        { key: "JAS", name: "James", chapters: 5 },
                        { key: "1PE", name: "1 Peter", chapters: 5 },
                        { key: "2PE", name: "2 Peter", chapters: 3 },
                        { key: "1JN", name: "1 John", chapters: 5 },
                        { key: "2JN", name: "2 John", chapters: 1 },
                        { key: "3JN", name: "3 John", chapters: 1 },
                        { key: "JUD", name: "Jude", chapters: 1 }
                    ]
                },
                {
                    name: "Prophecy",
                    books: [
                        { key: "REV", name: "Revelation", chapters: 22 }
                    ]
                }
            ]
        }
    ]
};

async function main() {
    console.log("Generating default star configuration...");
    
    // 1. Convert to Model
    const model = bibleToSceneModel(DATA);
    console.log(`Model created with ${model.nodes.length} nodes.`);

    // 2. Compute Layout
    // We use a large radius for the "Sky" feel.
    // The engine defaults to 2000, so let's match that.
    const layoutConfig = {
        mode: "spherical" as const,
        radius: 2000,
        chapterRingSpacing: 15
    };

    const laidOutModel = computeLayoutPositions(model, layoutConfig);

    // 3. Transform to a simplified configuration format?
    // The user asked for a "configuration JSON file... which maps stars to their positions".
    // We can export the full model, or just a map of ID -> {x,y,z}.
    // Providing the full model allows the engine to skip the `bibleToSceneModel` and `computeLayoutPositions` steps
    // if we update the engine to accept it.
    
    // Let's save the full SceneModel but maybe trim some undefined fields to save space.
    const output = {
        meta: {
            generatedAt: new Date().toISOString(),
            layout: layoutConfig
        },
        nodes: laidOutModel.nodes.map(n => ({
            id: n.id,
            // Keep label/level/parent for context, though strictly position is in meta
            label: n.label,
            level: n.level,
            parent: n.parent,
            // The important part: coordinates in meta
            x: (n.meta as any).x,
            y: (n.meta as any).y,
            z: (n.meta as any).z,
            // Keep other meta?
            meta: n.meta
        })),
        links: laidOutModel.links // Links might be useful for lines
    };

    const outPath = path.resolve(process.cwd(), "src/assets/default-stars.json");
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
    
    console.log(`Done! Written to ${outPath}`);
}

main().catch(console.error);
