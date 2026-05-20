#!/usr/bin/env node
import { config } from "dotenv";
config();

const GITLAB_URL = process.env.GITLAB_URL || "https://gitlab.com";
const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
const HEADERS = { "PRIVATE-TOKEN": GITLAB_TOKEN };

const projectsRes = await fetch(
  `${GITLAB_URL}/api/v4/projects?membership=true&per_page=50`,
  { headers: HEADERS },
);
const projects = await projectsRes.json();

if (!Array.isArray(projects)) {
  console.error("GitLab API error:", projects);
  process.exit(1);
}

console.log(`Found ${projects.length} projects\n`);

const authors = new Map();

for (const project of projects) {
  // get all branches
  const branchRes = await fetch(
    `${GITLAB_URL}/api/v4/projects/${project.id}/repository/branches?per_page=100`,
    { headers: HEADERS },
  );
  const branches = await branchRes.json();
  if (!Array.isArray(branches)) continue;

  for (const branch of branches) {
    const res = await fetch(
      `${GITLAB_URL}/api/v4/projects/${project.id}/repository/commits?ref_name=${branch.name}&per_page=100`,
      { headers: HEADERS },
    );
    const commits = await res.json();
    if (!Array.isArray(commits)) continue;

    for (const c of commits) {
      const key = `${c.author_name}|${c.author_email}`;
      if (!authors.has(key)) {
        authors.set(key, { name: c.author_name, email: c.author_email, count: 0 });
      }
      authors.get(key).count++;
    }
  }
}

console.log("All unique authors found across all branches:\n");
for (const { name, email, count } of [...authors.values()].sort((a, b) => b.count - a.count)) {
  console.log(`  name:  "${name}"`);
  console.log(`  email: "${email}"`);
  console.log(`  commits: ${count}\n`);
}
