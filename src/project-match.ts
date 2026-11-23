import type { SerpdinoProject } from './types.js';

/** "https://www.Example.com/path" → "example.com" */
export function normalizeDomain(value: string | null | undefined): string {
  if (!value) return '';
  let host = value.trim().toLowerCase();
  host = host.replace(/^[a-z]+:\/\//, '').split('/')[0].split('?')[0].split(':')[0];
  return host.replace(/^www\./, '');
}

/** Project whose domain or alias equals the site domain (www and protocol ignored). */
export function findProjectByDomain(projects: SerpdinoProject[], domain: string | null | undefined): SerpdinoProject | null {
  const target = normalizeDomain(domain);
  if (!target) return null;
  return (
    projects.find((project) => {
      const names = [project.domain, ...(project.aliases ?? [])].map(normalizeDomain);
      return names.includes(target);
    }) ?? null
  );
}

/**
 * Which project to show: explicit choice (select / prop) → project of the site domain → first project.
 */
export function pickProject(
  projects: SerpdinoProject[],
  { selectedId, domain }: { selectedId?: string | null; domain?: string | null }
): SerpdinoProject | null {
  return (
    (selectedId ? projects.find((project) => project._id === selectedId) : undefined) ??
    findProjectByDomain(projects, domain) ??
    projects[0] ??
    null
  );
}
