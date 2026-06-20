import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BIBLE_PATH = path.resolve(__dirname, '../../builder/public/bible.json');
const DEFAULT_ARRANGEMENT_PATH = path.resolve(__dirname, '../../builder/public/test-arrangement.json');
const DEFAULT_OUTPUT_PATH = path.resolve(__dirname, '../../builder/public/division-regions.json');

// Padding applied beyond the outermost chapter so a division's region reads as
// an area rather than a tight outline. Tunable without re-running the layout.
const ANGULAR_PADDING_FACTOR = 1.35;
const ANGULAR_PADDING_MIN_RAD = 0.06;
const ANGULAR_RADIUS_MIN_RAD = 0.12;
const ANGULAR_RADIUS_MAX_RAD = 0.9;

interface Book {
    key: string;
    name: string;
}
interface Division {
    name: string;
    books: Book[];
}
interface Testament {
    name: string;
    divisions: Division[];
}
interface BibleData {
    testaments: Testament[];
}

type StarArrangement = {
    [id: string]: {
        position?: [number, number, number];
    };
};

interface DivisionRegion {
    direction: [number, number, number]; // unit vector — the division's true star centroid
    angularRadiusRad: number;            // padded angular extent of its stars around that centroid
    starCount: number;
}

function parseArgs(): { arrangementPath: string; outputPath: string } {
    const args = process.argv.slice(2);
    const arrangementPath = args[0] ? path.resolve(process.cwd(), args[0]) : DEFAULT_ARRANGEMENT_PATH;
    const outputPath = args[1] ? path.resolve(process.cwd(), args[1]) : DEFAULT_OUTPUT_PATH;
    return { arrangementPath, outputPath };
}

function buildBookToDivisionMap(bibleData: BibleData): Map<string, string> {
    const map = new Map<string, string>();
    for (const testament of bibleData.testaments) {
        for (const division of testament.divisions) {
            for (const book of division.books) {
                map.set(book.key, division.name);
            }
        }
    }
    return map;
}

function normalize(v: [number, number, number]): [number, number, number] {
    const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    if (len < 1e-9) return [0, 1, 0];
    return [v[0] / len, v[1] / len, v[2] / len];
}

function angleBetween(a: [number, number, number], b: [number, number, number]): number {
    const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    return Math.acos(dot);
}

function analyze() {
    const { arrangementPath, outputPath } = parseArgs();

    console.log(`Loading Bible hierarchy from ${BIBLE_PATH}...`);
    const bibleData = JSON.parse(fs.readFileSync(BIBLE_PATH, 'utf-8')) as BibleData;
    const bookToDivision = buildBookToDivisionMap(bibleData);

    console.log(`Loading arrangement from ${arrangementPath}...`);
    const arrangement = JSON.parse(fs.readFileSync(arrangementPath, 'utf-8')) as StarArrangement;

    // Group every chapter's world position by the division its book belongs to.
    const positionsByDivision = new Map<string, [number, number, number][]>();
    let skipped = 0;

    for (const [chapterId, entry] of Object.entries(arrangement)) {
        const match = /^C:([^:]+):(\d+)$/.exec(chapterId);
        if (!match || !entry.position) { skipped++; continue; }
        const bookKey = match[1]!;
        const divisionName = bookToDivision.get(bookKey);
        if (!divisionName) { skipped++; continue; }

        const list = positionsByDivision.get(divisionName) ?? [];
        list.push(entry.position);
        positionsByDivision.set(divisionName, list);
    }

    if (skipped > 0) {
        console.log(`Skipped ${skipped} arrangement entries (not a recognised chapter id or missing position).`);
    }

    const regions: Record<string, DivisionRegion> = {};

    for (const [divisionName, positions] of positionsByDivision.entries()) {
        const mean: [number, number, number] = [0, 0, 0];
        for (const p of positions) {
            mean[0] += p[0];
            mean[1] += p[1];
            mean[2] += p[2];
        }
        mean[0] /= positions.length;
        mean[1] /= positions.length;
        mean[2] /= positions.length;

        const direction = normalize(mean);

        let maxAngle = 0;
        for (const p of positions) {
            const angle = angleBetween(direction, normalize(p));
            if (angle > maxAngle) maxAngle = angle;
        }

        const angularRadiusRad = Math.min(
            ANGULAR_RADIUS_MAX_RAD,
            Math.max(ANGULAR_RADIUS_MIN_RAD, maxAngle * ANGULAR_PADDING_FACTOR + ANGULAR_PADDING_MIN_RAD),
        );

        regions[divisionName] = {
            direction,
            angularRadiusRad,
            starCount: positions.length,
        };
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(regions, null, 2));
    console.log(`Wrote ${Object.keys(regions).length} division regions to ${outputPath}`);
}

analyze();
