# GitLab → GitHub Contribution Sync

Mirrors your GitLab commits as empty dummy commits to a private GitHub repo — so your GitHub contribution graph stays active even when you work on GitLab.

**No source code is pushed to GitHub.** Only commit metadata (message, date, project name) is mirrored.

---

## How It Works

```
GitLab (your work) → script fetches commits → creates empty mirror commits → GitHub contribution graph ✅
```

1. Script fetches all projects you're a member of on GitLab
2. Filters commits authored by you
3. For each new commit, creates an empty commit on your private GitHub mirror repo
4. GitHub counts it as a contribution on your profile graph

---

## Prerequisites

- [Bun](https://bun.sh) installed (`curl -fsSL https://bun.sh/install | bash`)
- A GitHub account
- A GitLab account (self-hosted or gitlab.com)

---

## Setup

### 1. Clone & Install

```bash
git clone https://github.com/aHasnat1997/Syncing_Git_Contributions.git
cd Syncing_Git_Contributions
bun install
```

### 2. Create a GitHub Mirror Repo

Go to [github.com/new](https://github.com/new) and create a **private** repo (e.g. `gitlab-mirror`).

It must have at least one commit (initialize with a README).

### 3. Generate Tokens

**GitHub Token**
- Go to: GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
- Scopes needed: `repo`
- Copy the token

**GitLab Token**
- Go to: `https://your-gitlab.com/-/user_settings/personal_access_tokens`
- Scopes needed: `read_api`
- Copy the token

### 4. Configure `.env`

Create a `.env` file in the project root:

```env
GITHUB_TOKEN=github_pat_xxxxxxxxxxxxxxxx
GITHUB_OWNER=your-github-username
GITHUB_REPO=gitlab-mirror

GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx
GITLAB_USERNAME=your-gitlab-username
GITLAB_URL=https://gitlab.betopialimited.com   # or https://gitlab.com

FETCH_LIMIT=100
```

| Variable         | Description                                              |
|------------------|----------------------------------------------------------|
| `GITHUB_TOKEN`   | GitHub personal access token with `repo` scope          |
| `GITHUB_OWNER`   | Your GitHub username                                     |
| `GITHUB_REPO`    | Private GitHub repo to receive mirror commits            |
| `GITLAB_TOKEN`   | GitLab personal access token with `read_api` scope       |
| `GITLAB_USERNAME`| Your GitLab username                                     |
| `GITLAB_URL`     | GitLab base URL (default: `https://gitlab.com`)          |
| `FETCH_LIMIT`    | Max commits to fetch per project per run (default: `100`)|

---

## Usage

Run manually after pushing to GitLab:

```bash
bun run start
```

Example output:

```
🔍 Fetching your GitLab commits...
   Found 12 commits across all projects

🔍 Checking GitHub mirror for already-synced commits...
   Already mirrored: 8 commits

⬆️  Syncing 4 new commit(s) to GitHub...

  ✓ [a1b2c3d4] feat: add user authentication
       → github: e5f6g7h8 | project: mygroup/myproject

🎉 Done! Synced 4/4 commits to GitHub.
   View your mirror: https://github.com/your-username/gitlab-mirror
```

---

## Automate with Cron (Optional)

Run the sync automatically every hour:

```bash
crontab -e
```

Add:

```
0 * * * * cd /path/to/Syncing_Git_Contributions && bun run start >> sync.log 2>&1
```

---

## Project Structure

```
Syncing_Git_Contributions/
├── index.js        # Main sync script
├── package.json    # Dependencies
├── .env            # Your secrets (never commit this)
├── .gitignore      # Ignores .env and node_modules
└── README.md
```

---

## Security Notes

- `.env` is listed in `.gitignore` — your tokens are never committed
- The GitHub mirror repo should be **private**
- No actual source code from GitLab is ever pushed to GitHub
- Rotate your tokens if they are ever exposed
