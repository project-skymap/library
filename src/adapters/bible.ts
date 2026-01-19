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

export type GroupDefinition = Record<string, Array<{ 
    name: string; 
    start: number; 
    end: number;
    connections?: number[][];
}>>;

export function bibleToSceneModel(data: BibleJSON, groups?: GroupDefinition): SceneModel {
    const nodes: SceneNode[] = [];
    const links: SceneModel["links"] = [];

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
                const bid = id.book(b.key);
                nodes.push({
                    id: bid,
                    label: b.name,
                    level: 2,
                    parent: did,
                    meta: { testament: t.name, division: d.name, bookKey: b.key, book: b.name }
                });
                links.push({ source: bid, target: did });

                const bookGroups = groups?.[b.name.toLowerCase()];
                const groupNodes = new Map<number, string>(); // index -> id

                const verseCounts = b.verses ?? Array(b.chapters).fill(1);
                for (let i = 0; i < verseCounts.length; i++) {
                    const chapterNum = i + 1;
                    let parentId = bid;
                    let level = 3;
                    let groupIndex: number | undefined = undefined;

                    if (bookGroups) {
                        const idx = bookGroups.findIndex(g => chapterNum >= g.start && chapterNum <= g.end);
                        if (idx !== -1 && bookGroups[idx]) {
                            groupIndex = idx;
                            // Ensure Group Node exists
                            if (!groupNodes.has(idx)) {
                                const groupName = bookGroups[idx].name;
                                const gid = `${bid}:G${idx}`; // Unique ID
                                nodes.push({
                                    id: gid,
                                    label: groupName,
                                    level: 3,
                                    parent: bid,
                                    meta: { 
                                        testament: t.name, division: d.name, book: b.name, 
                                        group: groupName, groupIndex: idx,
                                        connections: bookGroups[idx].connections
                                    }
                                });
                                links.push({ source: gid, target: bid });
                                groupNodes.set(idx, gid);
                            }
                            parentId = groupNodes.get(idx)!;
                            level = 4;
                        }
                    }

                    const cid = id.chapter(b.key, chapterNum);
                    
                    nodes.push({
                        id: cid,
                        label: `${b.name} ${chapterNum}`,
                        level: level,
                        parent: parentId,
                        weight: verseCounts[i],
                        icon: b.icons?.[i] ?? b.icons?.[0], 
                        meta: {
                            testament: t.name,
                            division: d.name,
                            bookKey: b.key,
                            book: b.name,
                            chapter: chapterNum,
                            groupIndex
                        }
                    });
                    links.push({ source: cid, target: parentId });
                }
            }
        }
    }

    return { nodes, links };
}
