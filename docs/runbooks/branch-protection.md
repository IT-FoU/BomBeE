# Branch protection for `main` (Owner)

Agent GitHub token returns **403** for branch protection APIs. Owner (or org admin) must enable this in the GitHub UI.

## Recommended settings

Repo: `IT-FoU/BomBeE` → **Settings → Branches → Add branch protection rule**

| Setting | Value |
| --- | --- |
| Branch name pattern | `main` |
| Require a pull request before merging | On |
| Require approvals | 1 (Owner) |
| Require status checks to pass | On |
| Required checks | `Typecheck · Lint · Test · Build`, `Dependency / security scan`, `Secret scan`, `Migration validation` |
| Require branches to be up to date | On (if checks are stable) |
| Do not allow bypassing the above settings | On for everyone except emergency Owner break-glass |
| Restrict who can push | No direct pushes except break-glass |

## Verify

After saving, open a test PR and confirm merge is blocked until checks are green.
