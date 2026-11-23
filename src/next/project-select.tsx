'use client';

import type { ChangeEvent } from 'react';

export interface ProjectSelectProps {
  projects: { id: string; label: string }[];
  value: string;
  /** Query parameter that carries the chosen project. */
  param: string;
}

/** Site switcher: changing the select reloads the page with ?project=<id>. Works without JS via the button. */
export function ProjectSelect({ projects, value, param }: ProjectSelectProps) {
  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    event.currentTarget.form?.requestSubmit();
  };

  return (
    <form method="get" className="sdp-switcher">
      <label className="sdp-label" htmlFor="sdp-project">
        Site
      </label>
      <select id="sdp-project" name={param} defaultValue={value} onChange={handleChange} className="sdp-select">
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.label}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="sdp-button">
          Show
        </button>
      </noscript>
    </form>
  );
}
