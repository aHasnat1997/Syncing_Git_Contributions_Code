#!/usr/bin/env node
import { config } from "dotenv";
import { Octokit } from "@octokit/rest";

config();

const CONFIG = {
  github_token: process.env.GITHUB_TOKEN,
  github_owner: process.env.GITHUB_OWNER,
  github_repo: process.env.GITHUB_REPO,
  github_email: process.env.GITHUB_EMAIL,
  gitlab_token: process.env.GITLAB_TOKEN,
  gitlab_username: process.env.GITLAB_USERNAME,
  gitlab_url: process.env.GITLAB_URL || "https://gitlab.com",
  fetch_limit: parseInt(process.env.FETCH_LIMIT || "100", 10),
};

const REQUIRED = ["github_token", "github_owner", "github_email", "gitlab_token", "gitlab_username"];
const missing = REQUIRED.filter((k) => !CONFIG[k]);
if (missing.length > 0) {
  console.error("❌ Missing required environment variables:");
  missing.forEach((k) => console.error(`   ${k.toUpperCase()}`));
  process.exit(1);
}

const octokit = new Octokit({ auth: CONFIG.github_token });
const HEADERS = { "PRIVATE-TOKEN": CONFIG.gitlab_token };

async function getVerifiedGithubEmails() {
  try {
    const { data } = await octokit.request("GET /user/emails");
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.status === 403 || e.status === 401 || e.status === 404) {
      return null;
    }
    throw e;
  }
}

async function validateGithubEmail() {
  const emails = await getVerifiedGithubEmails();
  console.log(`   GitHub commit email: ${CONFIG.github_email}`);

  if (emails === null) {
    console.log(
      "   Could not verify GitHub emails with this token. If the graph still does not update, make sure GITHUB_EMAIL is a verified email on your GitHub account or use a token with user:email scope.\n",
    );
    return;
  }

  const match = emails.find((e) => e.email?.toLowerCase() === CONFIG.github_email.toLowerCase());
  if (!match) {
    console.warn(
      "⚠️  The configured GITHUB_EMAIL is not listed among the verified emails on this GitHub account. Commits made with it will not count on the contribution graph.\n",
    );
    console.warn("   Add that email to GitHub or change GITHUB_EMAIL to a verified GitHub email.\n");
    return;
  }

  if (!match.verified) {
    console.warn(
      "⚠️  The configured GITHUB_EMAIL is present on GitHub but is not verified. Unverified emails will not count toward contributions.\n",
    );
  }
}

async function getMyGitLabIdentity() {
  const [userRes, emailsRes] = await Promise.all([
    fetch(`${CONFIG.gitlab_url}/api/v4/user`, { headers: HEADERS }),
    fetch(`${CONFIG.gitlab_url}/api/v4/user/emails`, { headers: HEADERS }),
  ]);

  const user = await userRes.json();
  const emails = await emailsRes.json();

  if (!user.id) {
    console.error("❌ Failed to fetch GitLab user:", user);
    process.exit(1);
  }

  const myEmails = new Set();
  myEmails.add(user.email?.toLowerCase());
  myEmails.add(user.commit_email?.toLowerCase());
  myEmails.add(user.public_email?.toLowerCase());
  if (Array.isArray(emails)) {
    emails.forEach((e) => myEmails.add(e.email?.toLowerCase()));
  }
  myEmails.delete(undefined);
  myEmails.delete(null);
  myEmails.delete("");

  console.log(`   GitLab user: ${user.name} (@${user.username})`);
  console.log(`   Known emails: ${[...myEmails].join(", ")}\n`);

  return { myEmails };
}

async function getGitLabCommits(myEmails) {
  const projectsRes = await fetch(
    `${CONFIG.gitlab_url}/api/v4/projects?membership=true&per_page=50`,
    { headers: HEADERS },
  );
  const projects = await projectsRes.json();

  if (!Array.isArray(projects)) {
    console.error("GitLab API error:", projects);
    process.exit(1);
  }

  const allCommits = [];
  const seenIds = new Set();

  for (const project of projects) {
    const branchRes = await fetch(
      `${CONFIG.gitlab_url}/api/v4/projects/${project.id}/repository/branches?per_page=100`,
      { headers: HEADERS },
    );
    const branches = await branchRes.json();
    if (!Array.isArray(branches)) continue;

    for (const branch of branches) {
      const res = await fetch(
        `${CONFIG.gitlab_url}/api/v4/projects/${project.id}/repository/commits?ref_name=${encodeURIComponent(branch.name)}&per_page=${CONFIG.fetch_limit}`,
        { headers: HEADERS },
      );
      const commits = await res.json();
      if (!Array.isArray(commits)) continue;

      for (const c of commits) {
        if (seenIds.has(c.id)) continue;
        if (!myEmails.has(c.author_email?.toLowerCase())) continue;

        seenIds.add(c.id);
        allCommits.push({
          id: c.id,
          short_id: c.short_id,
          message: c.message,
          date: c.created_at,
          project: project.path_with_namespace,
        });
      }
    }
  }

  allCommits.sort((a, b) => new Date(a.date) - new Date(b.date));
  return allCommits;
}

async function getMirroredIds() {
  try {
    const { data: commits } = await octokit.repos.listCommits({
      owner: CONFIG.github_owner,
      repo: CONFIG.github_repo,
      per_page: 100,
    });

    const ids = new Set();
    for (const c of commits) {
      const match = c.commit.message.match(/gitlab-id:\s*([a-f0-9]{40})/);
      if (match) ids.add(match[1]);
    }
    return ids;
  } catch (e) {
    if (e.status === 409 || e.status === 404) return new Set();
    throw e;
  }
}

const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

async function getGithubRepoInfo() {
  const { data: repo } = await octokit.repos.get({
    owner: CONFIG.github_owner,
    repo: CONFIG.github_repo,
  });

  if (!repo?.default_branch) {
    throw new Error(`Unable to determine default branch for ${CONFIG.github_owner}/${CONFIG.github_repo}`);
  }

  return {
    defaultBranch: repo.default_branch,
    isPrivate: repo.private,
    isFork: repo.fork,
  };
}

async function getHeadState(defaultBranch) {
  try {
    const { data: refData } = await octokit.git.getRef({
      owner: CONFIG.github_owner,
      repo: CONFIG.github_repo,
      ref: `heads/${defaultBranch}`,
    });
    const parentSha = refData.object.sha;
    const { data: parentCommit } = await octokit.git.getCommit({
      owner: CONFIG.github_owner,
      repo: CONFIG.github_repo,
      commit_sha: parentSha,
    });
    return { parentSha, treeSha: parentCommit.tree.sha, isNew: false };
  } catch (e) {
    if (e.status === 404 || e.status === 409) {
      return { parentSha: null, treeSha: EMPTY_TREE_SHA, isNew: true };
    }
    throw e;
  }
}

async function createMirrorCommit(gitlabCommit, headState) {
  const message = [
    `[mirror] ${gitlabCommit.message.split("\n")[0].slice(0, 72)}`,
    ``,
    `project: ${gitlabCommit.project}`,
    `gitlab-id: ${gitlabCommit.id}`,
  ].join("\n");

  const { data: newCommit } = await octokit.git.createCommit({
    owner: CONFIG.github_owner,
    repo: CONFIG.github_repo,
    message,
    tree: headState.treeSha,
    parents: headState.parentSha ? [headState.parentSha] : [],
    author: {
      name: CONFIG.github_owner,
      email: CONFIG.github_email,
      date: gitlabCommit.date,
    },
    committer: {
      name: CONFIG.github_owner,
      email: CONFIG.github_email,
      date: gitlabCommit.date,
    },
  });

  if (headState.isNew) {
    await octokit.git.createRef({
      owner: CONFIG.github_owner,
      repo: CONFIG.github_repo,
      ref: `refs/heads/${headState.branchName}`,
      sha: newCommit.sha,
    });
  } else {
    await octokit.git.updateRef({
      owner: CONFIG.github_owner,
      repo: CONFIG.github_repo,
      ref: `heads/${headState.branchName}`,
      sha: newCommit.sha,
    });
  }

  headState.parentSha = newCommit.sha;
  headState.isNew = false;

  return newCommit.sha;
}

async function main() {
  const repoInfo = await getGithubRepoInfo();
  if (repoInfo.isFork) {
    console.warn(
      `⚠️  ${CONFIG.github_owner}/${CONFIG.github_repo} is a fork. GitHub contribution counts only work for standalone repositories.\n`,
    );
  }
  if (repoInfo.isPrivate) {
    console.log(
      "ℹ️  This is a private repo. To display these contributions on your profile graph, enable Private contributions in GitHub profile settings.\n",
    );
  }

  console.log("🔍 Fetching your GitLab identity...");
  await validateGithubEmail();
  const { myEmails } = await getMyGitLabIdentity();

  console.log("🔍 Fetching your GitLab commits (all branches)...");
  const glCommits = await getGitLabCommits(myEmails);
  console.log(`   Found ${glCommits.length} commits across all projects\n`);

  console.log("🔍 Checking GitHub mirror for already-synced commits...");
  const mirrored = await getMirroredIds();
  console.log(`   Already mirrored: ${mirrored.size} commits\n`);

  const toSync = glCommits.filter((c) => !mirrored.has(c.id));

  if (toSync.length === 0) {
    console.log("✅ Everything is already synced! Nothing to do.");
    return;
  }

  console.log(`⬆️  Syncing ${toSync.length} new commit(s) to GitHub...\n`);

  const headState = await getHeadState(repoInfo.defaultBranch);
  headState.branchName = repoInfo.defaultBranch;

  let synced = 0;
  for (const commit of toSync) {
    try {
      const sha = await createMirrorCommit(commit, headState);
      console.log(`  ✓ [${commit.short_id}] ${commit.message.split("\n")[0].slice(0, 50)}`);
      console.log(`       → github: ${sha.slice(0, 8)} | project: ${commit.project}\n`);
      synced++;
    } catch (err) {
      console.error(`  ✗ Failed: ${commit.short_id} — ${err.message}\n`);
    }
  }

  console.log(`\n🎉 Done! Synced ${synced}/${toSync.length} commits to GitHub.`);
  console.log(`   View your mirror: https://github.com/${CONFIG.github_owner}/${CONFIG.github_repo}`);
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message);
  process.exit(1);
});
