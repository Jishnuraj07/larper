# Code signing with SignPath

Windows releases are signed through the [SignPath Foundation](https://signpath.org) program for open-source projects. The certificate belongs to SignPath Foundation, so installers show it as the publisher.

## One-time setup

1. **Apply** at <https://signpath.org/apply.html> with this repository's URL. Wait for approval.
2. **Connect GitHub.** In SignPath, add this repository as a trusted build system (GitHub.com), and install the SignPath GitHub app on the repository when prompted.
3. **Create the project** with the slug `larper`, linked to this repository.
4. **Add the artifact configuration** with the slug `installers`, and paste in [`artifact-configuration.xml`](artifact-configuration.xml).
5. **Create the signing policy** with the slug `release-signing`, using the release certificate SignPath Foundation provides. Require manual approval, and make yourself the approver.
6. **Create a CI user** in SignPath, give it submitter rights on the `release-signing` policy, and copy its API token.
7. **Add the GitHub settings** under *Settings → Secrets and variables → Actions*:
   - secret `SIGNPATH_API_TOKEN`: the CI user's API token
   - variable `SIGNPATH_ORGANIZATION_ID`: your SignPath organization ID

## Releasing

```sh
npm version 1.1.0 --no-git-tag-version   # bump the version
git commit -am "Release 1.1.0"
git tag v1.1.0
git push origin main v1.1.0
```

The [Release workflow](../.github/workflows/release.yml) then:

1. Builds and tests on Windows, and packages the installer and the portable app.
2. Submits them to SignPath, then waits up to an hour for you to approve the request in SignPath.
3. Creates a **draft** GitHub release with the signed files and their checksums.

Write the notes, attach screenshots if you like, and publish the draft.

## What is and isn't signed

The installer and the portable executable are signed, and those are the files Windows checks when someone downloads and runs them. The app executable packed inside them is not signed yet. Signing it would mean signing in two passes: sign the unpacked app first, then build the installers from it and sign those.
