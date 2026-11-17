# Contributing

## Requirements

- [Node](https://nodejs.org) 24, the runtime that `action.yml` names.
- npm, which comes with Node.
- [Task](https://taskfile.dev) for `task release`. `mise install` sets up Node
  and Task from `mise.toml`.

## Development

Install the dependencies:

```sh
npm ci
```

Build, check the formatting, lint and test in one run:

```sh
npm run all
```

Or run each step on its own:

```sh
npm run build          # compile to lib/ and bundle to dist/
npm run format         # format the TypeScript with Prettier
npm run format-check
npm run lint
npm test
```

## The committed bundle

The action runs `dist/index.js`, not the TypeScript source. Run `npm run build`
and commit `dist/` with every change to `src/` or to the dependencies. CI
rebuilds the bundle and fails when the committed `dist/` differs from the source.

## Layout

```
action.yml             The inputs, the outputs and the Node runtime.
src/main.ts            The entry point. It validates, deploys, polls and sets the outputs.
src/inputs.ts          Validates every input before anything else runs.
src/oidc.ts            Requests a GitHub OIDC token for the apervia-deploy audience.
src/http.ts            The HTTP client: no redirects, a timeout and a response size cap.
src/api.ts             The two platform routes.
src/poll.ts            Polls the release until it is ready, failed or superseded.
src/version.ts         The action version that the platform records.
scripts/release.ts     Publishes the package.json version as a GitHub Release.
__test__/              The Jest tests.
dist/                  The committed bundle that the action runs.
docs/wire-contract.md  The contract between the action and the platform.
```

## The wire contract

[`docs/wire-contract.md`](docs/wire-contract.md) describes what the action sends
and what the platform answers. A workflow keeps the release it names until
someone changes it, so the platform must keep serving every release that is
still in use.

## Releases

Each release is a whole number: `v1`, `v2`, `v3`.

1. Set the version in `package.json` and in `src/version.ts` to the release
   number followed by `.0.0`, for example `2.0.0` for `v2`. npm needs a full
   version, a test fails when the two differ, and the platform records it on
   every deployment.
2. Run `npm install` to update `package-lock.json`, then `npm run build`, and
   merge the change into `main`.
3. Publish the release from an up-to-date `main`:

   ```sh
   task release
   ```

   It refuses a dirty tree, a branch other than `main`, a `main` out of sync
   with `origin` and a version that is already released, then asks before it
   runs `gh release create`.
