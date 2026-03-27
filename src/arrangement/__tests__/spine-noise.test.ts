import { describe, it, expect } from "vitest";
import { generateArrangement, defaultGenerateOptions } from "../strategies/spine-noise";
import { computeSphericalArrangement } from "../strategies/spherical";
import { length, normalized, dot, vec3, add, multiplyScalar, clone, lengthSq } from "../math";
import { bibleToSceneModel } from "../../adapters/bible";
import type { BibleJSON } from "../../adapters/bible";

// ---------------------------------------------------------------------------
// Minimal fixture — two testaments, two divisions, three books
// ---------------------------------------------------------------------------

const FIXTURE: BibleJSON = {
    testaments: [
        {
            name: "Old",
            divisions: [
                {
                    name: "Law",
                    books: [
                        { key: "GEN", name: "Genesis", chapters: 3 },
                        { key: "EXO", name: "Exodus", chapters: 2 },
                    ],
                },
                {
                    name: "Poetry",
                    books: [
                        { key: "PSA", name: "Psalms", chapters: 4 },
                    ],
                },
            ],
        },
        {
            name: "New",
            divisions: [
                {
                    name: "Gospels",
                    books: [
                        { key: "MAT", name: "Matthew", chapters: 2 },
                    ],
                },
            ],
        },
    ],
};

// ---------------------------------------------------------------------------
// math.ts helpers
// ---------------------------------------------------------------------------

describe("math helpers", () => {
    it("normalized returns a unit vector", () => {
        const v = normalized(vec3(3, 4, 0));
        expect(length(v)).toBeCloseTo(1.0, 10);
    });

    it("normalized does not mutate its input", () => {
        const v = vec3(3, 4, 0);
        normalized(v);
        expect(v[0]).toBe(3);
        expect(v[1]).toBe(4);
        expect(v[2]).toBe(0);
    });

    it("normalized handles zero-length vector without throwing", () => {
        const v = normalized(vec3(0, 0, 0));
        expect(v[0]).toBe(0);
        expect(v[1]).toBe(0);
        expect(v[2]).toBe(0);
    });

    it("dot product of perpendicular vectors is 0", () => {
        expect(dot(vec3(1, 0, 0), vec3(0, 1, 0))).toBe(0);
    });

    it("dot product of parallel vectors equals product of lengths", () => {
        expect(dot(vec3(2, 0, 0), vec3(3, 0, 0))).toBe(6);
    });

    it("add returns a new vector", () => {
        const a = vec3(1, 2, 3);
        const b = vec3(4, 5, 6);
        const c = add(a, b);
        expect(c).toEqual([5, 7, 9]);
        expect(c).not.toBe(a);
        expect(c).not.toBe(b);
    });

    it("multiplyScalar returns a new vector", () => {
        const v = vec3(1, 2, 3);
        const scaled = multiplyScalar(v, 2);
        expect(scaled).toEqual([2, 4, 6]);
        expect(scaled).not.toBe(v);
    });

    it("clone returns a new independent copy", () => {
        const v = vec3(1, 2, 3);
        const c = clone(v);
        expect(c).toEqual(v);
        expect(c).not.toBe(v);
        c[0] = 99;
        expect(v[0]).toBe(1);
    });

    it("lengthSq equals length squared", () => {
        const v = vec3(3, 4, 0);
        expect(lengthSq(v)).toBeCloseTo(length(v) ** 2, 10);
    });
});

// ---------------------------------------------------------------------------
// generateArrangement — determinism
// ---------------------------------------------------------------------------

describe("generateArrangement — determinism", () => {
    it("same seed produces identical output", () => {
        const a = generateArrangement(FIXTURE, { seed: 42 });
        const b = generateArrangement(FIXTURE, { seed: 42 });
        expect(a).toEqual(b);
    });

    it("different seeds produce different output", () => {
        const a = generateArrangement(FIXTURE, { seed: 42 });
        const b = generateArrangement(FIXTURE, { seed: 99 });
        expect(a["B:GEN"]?.position).not.toEqual(b["B:GEN"]?.position);
    });

    it("default seed is deterministic across calls", () => {
        const a = generateArrangement(FIXTURE);
        const b = generateArrangement(FIXTURE);
        expect(a).toEqual(b);
    });
});

// ---------------------------------------------------------------------------
// generateArrangement — output shape
// ---------------------------------------------------------------------------

describe("generateArrangement — output shape", () => {
    const arr = generateArrangement(FIXTURE, { seed: 1 });

    it("generates a book entry for every book", () => {
        expect(arr["B:GEN"]).toBeDefined();
        expect(arr["B:EXO"]).toBeDefined();
        expect(arr["B:PSA"]).toBeDefined();
        expect(arr["B:MAT"]).toBeDefined();
    });

    it("generates a chapter entry for every chapter", () => {
        expect(arr["C:GEN:1"]).toBeDefined();
        expect(arr["C:GEN:2"]).toBeDefined();
        expect(arr["C:GEN:3"]).toBeDefined();
        expect(arr["C:EXO:1"]).toBeDefined();
        expect(arr["C:EXO:2"]).toBeDefined();
        expect(arr["C:PSA:4"]).toBeDefined();
        expect(arr["C:MAT:2"]).toBeDefined();
    });

    it("does not generate a chapter beyond the book's count", () => {
        expect(arr["C:GEN:4"]).toBeUndefined();
        expect(arr["C:EXO:3"]).toBeUndefined();
    });

    it("generates a division entry for every division", () => {
        expect(arr["D:Old:Law"]).toBeDefined();
        expect(arr["D:Old:Poetry"]).toBeDefined();
        expect(arr["D:New:Gospels"]).toBeDefined();
    });

    it("every entry position is a 3-tuple of finite numbers", () => {
        for (const [id, entry] of Object.entries(arr)) {
            const pos = entry.position;
            expect(pos, `${id} should have position`).toBeDefined();
            expect(pos).toHaveLength(3);
            for (const coord of pos!) {
                expect(typeof coord, `${id} coord should be number`).toBe("number");
                expect(isFinite(coord), `${id} coord should be finite`).toBe(true);
            }
        }
    });
});

// ---------------------------------------------------------------------------
// generateArrangement — geometric constraints
// ---------------------------------------------------------------------------

describe("generateArrangement — geometric constraints", () => {
    it("all chapter positions are above the horizon (y > 0)", () => {
        const arr = generateArrangement(FIXTURE, { seed: 1 });
        for (const [id, entry] of Object.entries(arr)) {
            if (id.startsWith("C:")) {
                expect(entry.position![1], `${id} y-coord`).toBeGreaterThan(0);
            }
        }
    });

    it("chapter positions are within expected radius range", () => {
        const radius = 2000;
        const arr = generateArrangement(FIXTURE, { seed: 1, discRadius: radius });
        for (const [id, entry] of Object.entries(arr)) {
            if (id.startsWith("C:")) {
                const [x, y, z] = entry.position!;
                const r = Math.sqrt(x * x + y * y + z * z);
                // Radius should equal discRadius (chapters sit on the sphere surface)
                expect(r, `${id} radius`).toBeCloseTo(radius, 0);
            }
        }
    });

    it("book positions are on the sphere surface at discRadius", () => {
        const radius = 2000;
        const arr = generateArrangement(FIXTURE, { seed: 1, discRadius: radius });
        for (const [id, entry] of Object.entries(arr)) {
            if (id.startsWith("B:")) {
                const [x, y, z] = entry.position!;
                const r = Math.sqrt(x * x + y * y + z * z);
                expect(r, `${id} radius`).toBeCloseTo(radius, 0);
            }
        }
    });
});

// ---------------------------------------------------------------------------
// generateArrangement — book-size-aware spread
// ---------------------------------------------------------------------------

describe("generateArrangement — bookSizeAware", () => {
    // FIXTURE median chapter count: sorted [2, 2, 3, 4] → index 2 → median = 3
    // EXO/MAT have 2 chapters → multiplier = sqrt(2/3) ≈ 0.816
    // PSA has 4 chapters → multiplier = sqrt(4/3) ≈ 1.155
    // GEN has 3 chapters → multiplier = sqrt(3/3) = 1.0

    function meanChapterDist(arr: ReturnType<typeof generateArrangement>, bookKey: string, chapters: number): number {
        const bookPos = arr[`B:${bookKey}`]?.position;
        if (!bookPos) return 0;
        let total = 0;
        for (let c = 1; c <= chapters; c++) {
            const cp = arr[`C:${bookKey}:${c}`]?.position;
            if (!cp) continue;
            const dx = cp[0] - bookPos[0], dy = cp[1] - bookPos[1], dz = cp[2] - bookPos[2];
            total += Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
        return total / chapters;
    }

    it("short books cluster more tightly than long books with bookSizeAware: true", () => {
        // Use a seed that deterministically places books; run many seeds and check the pattern holds
        let shortTighterCount = 0;
        for (let seed = 1; seed <= 20; seed++) {
            const arr = generateArrangement(FIXTURE, { seed, bookSizeAware: true });
            // EXO (2ch) vs PSA (4ch) — EXO should be tighter on average
            const exoDist = meanChapterDist(arr, "EXO", 2);
            const psaDist = meanChapterDist(arr, "PSA", 4);
            if (exoDist < psaDist) shortTighterCount++;
        }
        // Should hold for the majority of seeds
        expect(shortTighterCount).toBeGreaterThan(14);
    });

    it("bookSizeAware: false produces the same result as bookSizeAware: false (deterministic)", () => {
        const a = generateArrangement(FIXTURE, { seed: 42, bookSizeAware: false });
        const b = generateArrangement(FIXTURE, { seed: 42, bookSizeAware: false });
        expect(a).toEqual(b);
    });

    it("bookSizeAware: true and false produce different outputs", () => {
        const withScaling    = generateArrangement(FIXTURE, { seed: 42, bookSizeAware: true });
        const withoutScaling = generateArrangement(FIXTURE, { seed: 42, bookSizeAware: false });
        // EXO has 2 chapters (below median 3) — its cluster should differ
        expect(withScaling["C:EXO:1"]?.position).not.toEqual(withoutScaling["C:EXO:1"]?.position);
    });
});

// ---------------------------------------------------------------------------
// generateArrangement — snapshot (locks output against regressions)
// ---------------------------------------------------------------------------

describe("generateArrangement — snapshot", () => {
    it("seed 12345 produces stable output for fixed fixture", () => {
        const arr = generateArrangement(FIXTURE, { seed: 12345 });
        expect(arr).toMatchSnapshot();
    });
});

// ---------------------------------------------------------------------------
// computeSphericalArrangement
// ---------------------------------------------------------------------------

describe("computeSphericalArrangement — output shape", () => {
    const model = bibleToSceneModel(FIXTURE);
    const result = computeSphericalArrangement(model, { radius: 2000 });
    const { arrangement, divisionBoundaries } = result;

    it("returns a divisionBoundaries array with one entry per division", () => {
        // FIXTURE has 3 divisions across both testaments
        expect(divisionBoundaries).toHaveLength(3);
        expect(divisionBoundaries.every(b => typeof b === "number")).toBe(true);
    });

    it("division boundaries are non-decreasing angles", () => {
        for (let i = 1; i < divisionBoundaries.length; i++) {
            expect(divisionBoundaries[i]!).toBeGreaterThanOrEqual(divisionBoundaries[i - 1]!);
        }
    });

    it("generates a position for every node in the model", () => {
        for (const node of model.nodes) {
            expect(arrangement[node.id], `${node.id} should have an arrangement entry`).toBeDefined();
            const pos = arrangement[node.id]?.position;
            expect(pos, `${node.id} should have a position`).toBeDefined();
            expect(pos).toHaveLength(3);
        }
    });

    it("all positions are finite numbers", () => {
        for (const [id, entry] of Object.entries(arrangement)) {
            for (const coord of entry.position!) {
                expect(isFinite(coord), `${id} coord should be finite`).toBe(true);
            }
        }
    });

    it("book positions are approximately on the sphere surface", () => {
        for (const [id, entry] of Object.entries(arrangement)) {
            if (!id.startsWith("B:")) continue;
            const [x, y, z] = entry.position!;
            const r = Math.sqrt(x * x + y * y + z * z);
            expect(r, `${id} should be near radius 2000`).toBeCloseTo(2000, 0);
        }
    });

    it("produces identical output for the same model and radius", () => {
        const a = computeSphericalArrangement(model, { radius: 2000 });
        const b = computeSphericalArrangement(model, { radius: 2000 });
        expect(a.arrangement).toEqual(b.arrangement);
        expect(a.divisionBoundaries).toEqual(b.divisionBoundaries);
    });

    it("snapshot: stable output for fixed fixture", () => {
        expect(result).toMatchSnapshot();
    });
});
