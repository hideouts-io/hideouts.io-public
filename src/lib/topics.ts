/**
 * Topic pages from the repositories' GitHub topics. A topic gets a page only
 * when it connects projects: at least two share it, they aren't just editions
 * of the same tool, and it isn't an implementation language or UI framework.
 */
import { entries, type Entry } from './content';

/** Topics about how a project is built rather than what it's about. */
const IGNORED = new Set(['swift', 'swiftui', 'python', 'pyside6', 'go', 'golang', 'cli']);

export const topicHref = (topic: string) => `/topics/${topic}/`;

function sameTool(list: Entry[]) {
  const [first, ...others] = list;
  return others.every((o) => first.editions?.some((ed) => ed.slug === o.slug));
}

/** Every topic with a page, most-shared first, and the projects that carry it. */
export function topicIndex(): { topic: string; projects: Entry[] }[] {
  const byTopic = new Map<string, Entry[]>();
  for (const e of entries()) {
    for (const t of e.gh.topics) {
      if (IGNORED.has(t)) continue;
      byTopic.set(t, [...(byTopic.get(t) ?? []), e]);
    }
  }
  return [...byTopic]
    .filter(([, list]) => list.length >= 2 && !sameTool(list))
    .map(([topic, projects]) => ({
      topic,
      // Research first, then apps, each in site order.
      projects: projects.sort((a, b) => (a.kind === b.kind ? a.order - b.order : a.kind === 'research' ? -1 : 1)),
    }))
    .sort((a, b) => b.projects.length - a.projects.length || a.topic.localeCompare(b.topic));
}

/** Topics that have pages, as a set, for linking chips. */
export const linkedTopics = () => new Set(topicIndex().map((t) => t.topic));
