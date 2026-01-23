import type { SceneModel, SceneNode } from "../types";

export type BibleJSON = {
    testaments: Array<{
        name: string;
        divisions: Array<{
            name: string;
            books: Array<{
                key: string;
                name: string;
                chapters: number;
                verses?: number[];
                icons?: string[];
            }>;
        }>;
    }>;
};

export function bibleToSceneModel(data: BibleJSON): SceneModel {
    const nodes: SceneNode[] = [];
    const links: SceneModel["links"] = [];
    let bookCounter = 0;

    const id = {
        testament: (t: string) => `T:${t}`,
        division: (t: string, d: string) => `D:${t}:${d}`,
        book: (key: string) => `B:${key}`,
        chapter: (key: string, ch: number) => `C:${key}:${ch}`
    };

    for (const t of data.testaments) {
        const tid = id.testament(t.name);
        nodes.push({ id: tid, label: t.name, level: 0, meta: { testament: t.name } });

        for (const d of t.divisions) {
            const did = id.division(t.name, d.name);
            nodes.push({
                id: did,
                label: d.name,
                level: 1,
                parent: tid,
                meta: { testament: t.name, division: d.name }
            });
            links.push({ source: did, target: tid });

            for (const b of d.books) {
                bookCounter++;
                const bookLabel = b.name;
                const bid = id.book(b.key);
                nodes.push({
                    id: bid,
                    label: bookLabel,
                    level: 2,
                    parent: did,
                    meta: { testament: t.name, division: d.name, bookKey: b.key, book: b.name }
                });
                links.push({ source: bid, target: did });

                const verseCounts = b.verses ?? Array(b.chapters).fill(1);
                for (let i = 0; i < verseCounts.length; i++) {
                    const chapterNum = i + 1;
                    const cid = id.chapter(b.key, chapterNum);
                    nodes.push({
                        id: cid,
                        label: `${bookLabel} ${chapterNum}`,
                        level: 3,
                        parent: bid,
                        weight: verseCounts[i],
                        icon: b.icons?.[i] ?? b.icons?.[0], 
                        meta: {
                            testament: t.name,
                            division: d.name,
                            bookKey: b.key,
                            book: b.name,
                            chapter: chapterNum
                        }
                    });
                    links.push({ source: cid, target: bid });
                }
            }
        }
    }

    return { nodes, links };
}
