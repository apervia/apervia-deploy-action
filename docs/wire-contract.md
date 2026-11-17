# The deployment wire contract

This is the contract between this action and the Apervia platform. A workflow
pins the action by a release tag, which never upgrades itself, so a workflow
pinned today must still deploy after later platform changes. The contract
therefore stays backward compatible with every release still in use.

## Transport

Both routes are served on the deployment origin of the installation,
`platform-url`, which defaults to `https://deploy.apervia.ai`.

The action:

- sends the GitHub OIDC token as `Authorization: Bearer <token>`, and never in
  a URL, an output, a file or an error;
- sends `X-Apervia-Action-Version` with its own semantic version;
- refuses a redirect rather than following one;
- gives every request a 30 second timeout;
- reads at most 64 KiB of any response.

The platform must not answer either route with a redirect. The action refuses
a 3xx, because following one would send the token to a host the user did not
name.

## What decides the target

The deployment trusts in your Apervia console decide where a job may deploy.
The submitted `target` chooses among those places. It grants nothing.

The `target` names one environment, and it never changes. From v4, the action
sends it. A workflow on an older release sends `application` and `environment`
instead. The platform still accepts them, but a slug changes when somebody
changes the application's address, and the workflow then stops deploying.

A trust admits a run by the repository, the workflow file, and the branches or
GitHub environments it lists. The platform deploys only when a trust admits the
run, the submitted target is an environment that such a trust is for, and the
image matches the image host and the image repository of that trust.

More than one trust can admit one run. That is how one repository feeds two
environments from one branch. The submitted target then chooses which of them
this job means.

## One workflow file

A trust names ONE workflow file, for example `deploy.yml`. Another workflow in
the same repository is refused, on the same branch and with the same image.

The platform compares `job_workflow_ref`, which names the file that holds the
job that asked for the token. A job that runs in a reusable workflow from
another repository is therefore refused. Put the deployment step in a workflow
file of the repository the trust names.

## POST /api/deploy/github

Request body:

```json
{
  "target": "env_abcdefghijklmnopqrst",
  "image": "ghcr.io/acme/widget@sha256:<64 lowercase hex characters>",
  "autoDeploy": false
}
```

A body names its environment by `target`, or by `application` and
`environment`, and never by both. A body with both is a `400`.

`autoDeploy` is optional, and its default is `true`. From v3, the action sends
the value of its `auto-deploy` input. When it is `false`, the platform holds the
deployment until a person releases it in the console. See
[Holding a deployment for a person](#holding-a-deployment-for-a-person).

A successful response is `202` for a new operation and `200` for a replay:

```json
{
  "operation": "<opaque id>",
  "state": "pending",
  "release": 42,
  "detail": "optional human readable text"
}
```

`operation` is required. `release` and `detail` are optional. The deployment is
idempotent on the job attempt. A repeated request from the same run attempt, for
the same environment and the same digest, returns the same operation. A new
run, or a new attempt of the same run, is a new deployment.

Deploying a digest that the environment already runs is still a new deployment,
with a new release.

## Holding a deployment for a person

With `"autoDeploy": false`, the platform records the image as an update that
waits. It records no release, and the environment keeps the version that it
runs.

- The answer is `waiting`, with no `release`. The action stops polling and
  succeeds.
- A person who can release the app releases the update in the console. The
  platform then checks the trust again, and refuses the release when the trust
  was removed, paused or changed since the run.
- A newer deployment from a workflow into the same environment replaces an
  update that waits. The replaced operation then answers `superseded`.
- The first deployment into an environment with no release is never held. It
  answers like any other deployment.

The field can only ask for less than the trust allows. The first request of an
operation decides the hold.

## GET /api/deploy/github/status?operation=&lt;id&gt;

The action requests a **fresh OIDC token for every poll**, because the platform
verifies one on each request and a token minted at the start of a long
deployment expires under it. The token must come from the same run and attempt
that started the operation. Possession of an operation id grants nothing on its
own.

A successful response is `200`, with the same body shape as above.

## States

| State | Meaning | The action |
| --- | --- | --- |
| `pending` | The release is not ready yet. | Polls again. |
| `ready` | The release is running. | Succeeds. |
| `failed` | The release will not become ready. `detail` says why. | Fails, and prints `detail`. |
| `superseded` | Another deployment replaced this one. | Fails. |
| `waiting` | The update waits for a person. Only a request with `"autoDeploy": false` gets it. | Succeeds when it asked for the hold, and fails otherwise. |

**This vocabulary is closed.** A state this version of the action does not
know fails the action and asks the user to upgrade. Adding a state would
therefore break every workflow that names an earlier release. `waiting` does
not break v2, because v2 never sends `autoDeploy`, and only a request that
asked for a hold gets `waiting`.

## Errors

Every non-success response carries a generic message:

```json
{ "error": "generic message" }
```

| Status | Meaning | The action |
| --- | --- | --- |
| `400` | The body is not valid, it names a target and slugs, the target is not one, or the image is not a repository and an exact digest. | Fails. |
| `401` | The token is missing, malformed, expired or not signed by the issuer. | Fails, and points the user at the deployment trust. |
| `403` | No trust admits the run, the submitted target is not one the admitting trusts are for, or the image is not the trust's. | Fails, and points the user at the deployment trust. |
| `404` | No such operation for this caller. | Fails. |
| `413` | The body is larger than the platform reads. | Fails. |
| `429` | The platform is busy. | Retries the poll, up to three consecutive failures. |
| `5xx` | The platform failed. | Retries the poll, up to three consecutive failures. |

`401` and `403` are deliberately coarse. A caller learns that it may not deploy.
It does not learn whether the repository is known, whether the environment
exists, or which comparison refused it.

There is one exception. When a trust admits the run but the body names another
target, the `403` names the targets that this run's own trusts admit it into,
for example `my-app/production (target env_abcdefghijklmnopqrst)`. The run may
already deploy there, so the answer discloses nothing that it cannot reach, and
the job log says how to correct the workflow.

A transport failure is retried on the same terms as a `429` and a `5xx`. A
deployment in flight survives one bad gateway; it does not survive a platform
that is down.

## The version header

`X-Apervia-Action-Version` is self-reported, so the platform treats it as
telemetry only. It never gates a trust decision. A request without the header
is still served.
