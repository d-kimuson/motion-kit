# Release

A release is a version of `@kimuson/motion-kit` on npm. The version is built from a signed `v<version>` tag by `.github/workflows/release.yml` and published with Trusted Publishing (OIDC); no npm token is stored in the repository. A published version is never changed: a fix is a new version. The reasoning is in the [npm distribution ADR](../decisions/20261029-npm-trusted-publishing-release.accepted.md).

## One-time setup (owner)

The first version of a new package can only be published by hand, because npm offers the trusted-publisher form in the settings of a package that already exists. `@kimuson/motion-kit` exists as `0.0.0`, published by hand; `0.0.1` is the first version `release.yml` publishes.

1. **Publish the first version from a clean checkout.** Build and strip the development fields exactly as the workflow does, so the tarball is the one the workflow would produce:

   ```bash
   git switch main && git pull
   pnpm install --frozen-lockfile
   pnpm build && pnpm exec clean-pkg-json
   npm pack --dry-run --ignore-scripts     # dist/, docs/index.md, docs/guide, THIRD_PARTY_LICENSES.md, README, LICENSE, package.json
   npm login                                  # an account with publish rights to @kimuson
   npm publish --access public --tag latest    # 2FA prompt
   git restore package.json
   ```

   This one publish carries no provenance attestation: npm generates it from the OIDC exchange, and a laptop has no OIDC identity. Every later release published by `release.yml` is attested.

   Do not push a tag for this publish. The tag triggers the workflow, which would try to publish a version npm already has and fail. The first tag names the next version (`v0.0.1` here).

2. **Configure the trusted publisher** on [npmjs.com](https://www.npmjs.com) → `@kimuson/motion-kit` → Settings → Trusted publishing → GitHub Actions. Every field is case-sensitive and npm does not validate it on save, only when a publish arrives:

   | Field                | Value         |
   | -------------------- | ------------- |
   | Organization or user | `d-kimuson`   |
   | Repository           | `motion-kit`  |
   | Workflow filename    | `release.yml` |
   | Environment name     | (empty)       |
   | Allowed actions      | `npm publish` |

   `release.yml` is the filename only: the file is `.github/workflows/release.yml`, and `package.json#repository.url` is `git+https://github.com/d-kimuson/motion-kit.git` to match the repository npm sends with the publish. Renaming either breaks publishing until this form is updated.

3. **Complete the first OIDC publish within 2 days.** A new trusted publisher configuration expires if it is not validated by a successful publish in that window, and an expired configuration cannot be edited — it has to be deleted and recreated. Cut the next release (a patch is enough) as soon as the configuration is saved: the `0.0.1` configuration must publish before 2026-10-30 17:53 UTC.

4. **Restrict token publishing.** Settings → Publishing access → "Require two-factor authentication and disallow tokens". Trusted publishing keeps working; only traditional tokens stop, so a leaked token cannot publish.

## Version bump

Work from the repository root, on `main`, with a clean working tree. `npm version` refuses a dirty tree, and the commit and the tag must be signed (SSH):

```bash
git branch --show-current                   # main
git status --short                          # empty
git config --get tag.gpgsign                # true
```

| Spec                        | `npm version` argument    | Example                                           |
| --------------------------- | ------------------------- | ------------------------------------------------- |
| `patch` / `minor` / `major` | the same                  | `0.0.1` → `0.0.2`; `0.1.1-beta.2` → `0.1.1`       |
| `beta`                      | `prerelease --preid beta` | `0.1.0` → `0.1.1-beta.0`; `…-beta.0` → `…-beta.1` |
| an explicit semver          | the version               | `0.2.0`, `0.2.0-beta.0`                           |

```bash
npm version <argument> -m "chore: release v%s"
```

`npm version` runs the `preversion` script first (`pnpm lint && pnpm typecheck && pnpm test && pnpm build`), then writes `package.json#version`, the signed commit `chore: release v<version>` and the signed annotated tag `v<version>`. If a check fails, nothing is committed or tagged; fix it in a normal commit and run `npm version` again. If the push fails after the commit and tag exist, fix the cause and push again — do not rerun `npm version`.

A prerelease (`0.1.1-beta.0`) publishes under the dist-tag of its identifier (`beta`), so `@latest` only ever resolves to a release and a beta is installed with `@kimuson/motion-kit@beta`.

## Push and watch the workflow

```bash
git push --follow-tags
```

The tag starts the Release workflow. It verifies that the tag names the version in `package.json`, builds, strips the development fields with `clean-pkg-json`, and publishes with the npm CLI bundled with `.node-version` (Trusted Publishing needs npm 11.5.1 or later; the job checks it before publishing).

```bash
TAG="v0.0.2" # replace
RUN_ID="$(gh run list --workflow Release --limit 20 --json databaseId,headBranch,event --jq ".[] | select(.headBranch == \"$TAG\" and .event == \"push\") | .databaseId" | head -n 1)"
test -n "$RUN_ID" && gh run watch "$RUN_ID" --exit-status
gh run view "$RUN_ID" --log-failed   # when it fails
```

A version npm has not accepted can be retried by rerunning the workflow. Once npm has the version, the number is spent: release the fix as the next version.

## Verify the publish

```bash
VERSION="0.0.2" # replace, without the leading v
npm view "@kimuson/motion-kit@$VERSION" version
npm dist-tag ls @kimuson/motion-kit
npm view @kimuson/motion-kit@$VERSION dependencies devDependencies engines repository
```

The dist-tag list must show the new version under `latest` (or under `beta` for a prerelease), and the published `package.json` must carry no `devDependencies` and no `scripts`. The tarball is `dist/`, the user documentation (`docs/index.md` and `docs/guide`), `THIRD_PARTY_LICENSES.md`, `README.md`, `LICENSE` and `package.json` — the same list a local `npm pack --dry-run --ignore-scripts` prints.

A version published by the workflow is attested. The package and the repository are both public, so npm generates the provenance statement from the OIDC identity the publish already presents:

```bash
npm view "@kimuson/motion-kit@$VERSION" dist.attestations dist.tarball
npm audit signatures
```

`dist.attestations` present and `npm audit signatures` reporting the version are the success condition. The manual `0.0.0` publish has no attestation, and its absence is expected there, not a failure.

## GitHub Release

```bash
TAG="v0.0.2" # replace
gh release create "$TAG" --verify-tag --draft --generate-notes $([[ "$TAG" == *-* ]] && echo --prerelease)
gh release view "$TAG" --json body --jq .body
```

Rewrite the generated notes before publishing them: concise, user-focused English; the sections `Features`, `Bug Fixes` and `Breaking Changes` when they apply; the impact on a consumer's code and on the CLI rather than implementation detail; drop formatting-only, dependency-only and internal items. Publish the draft with the rewritten notes:

```bash
NOTES_FILE="/tmp/motion-kit-$TAG-release-notes.md" # write it with the file editor
gh release edit "$TAG" --notes-file "$NOTES_FILE" --draft=false
```

## When it fails

| Symptom                                           | Cause and fix                                                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `tag v… does not match package.json version …`    | The tag and the version disagree. Nothing was published; delete the wrong tag (`git push origin :v<wrong>`) and tag again.           |
| `ENEEDAUTH` or `Unable to authenticate`           | The workflow filename, repository or `repository.url` does not match the trusted publisher form on npmjs.com.                        |
| `403`, or the publish is not authenticated at all | The configuration expired (no OIDC publish within 2 days) or `id-token: write` is missing. Recreate the configuration, then publish. |
| `EPUBLISHCONFLICT` / `cannot publish over …`      | The version is already on npm. Never reuse the number; release the next version.                                                     |
| No `dist.attestations` on a tagged release        | The publish did not go through OIDC (see `ENEEDAUTH`). A CI publish is attested; only the manual `0.0.0` has none.                   |
