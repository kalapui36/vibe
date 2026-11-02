import { escape } from './shared.js';

export const searchKey = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ko').replace(/\s+/gu, '');
export function matchesSearch(app, query) {
  return searchKey(`${app.name} ${app.description || ''}`).includes(searchKey(query));
}
export function suggestions(apps, query) {
  const key = searchKey(query);
  if (!key) return [];
  return apps.filter(app => searchKey(app.name).includes(key))
    .map((app, index) => ({ app, index, rank: searchKey(app.name).startsWith(key) ? 0 : 1 }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index).slice(0, 6).map(row => row.app);
}
export function highlightedName(name, query) {
  const key = searchKey(query), chars = Array.from(name), normalized = [], owners = [];
  chars.forEach((char, index) => {
    const part=searchKey(char);normalized.push(part);
    for(let offset=0;offset<part.length;offset++)owners.push(index);
  });
  const start = normalized.join('').indexOf(key);
  if (!key || start < 0) return escape(name);
  const first = owners[start], last = owners[start + key.length - 1];
  return `${escape(chars.slice(0, first).join(''))}<mark>${escape(chars.slice(first, last + 1).join(''))}</mark>${escape(chars.slice(last + 1).join(''))}`;
}
