import * as core from '@actions/core'
import { type Deployment, readStatus, startDeployment } from './api.js'
import { RequestError } from './http.js'
import { InputError, type Inputs, describeDestination, readInputs } from './inputs.js'
import { TokenError, requestToken } from './oidc.js'
import { TimeoutError, waitForRelease } from './poll.js'

async function run(): Promise<void> {
  // Validate first. A bad input is the common mistake, and there is no reason
  // to ask the runner for a credential before the request is known to be sound.
  const inputs = readInputs()
  core.info(
    `Deploying ${inputs.image.reference} to ${describeDestination(inputs.destination)} at ${inputs.platformUrl.origin}.`
  )

  const accepted = await startDeployment(inputs, await requestToken())
  core.info(`The platform accepted the deployment as operation ${accepted.operation}.`)

  const final = await waitForRelease(() => poll(inputs, accepted.operation), {
    pollIntervalMs: inputs.pollIntervalMs,
    timeoutMs: inputs.timeoutMs,
    onRetry: (error, attempt) => core.warning(`Status poll ${attempt} failed: ${error.message}`)
  })

  publish(inputs, final)

  if (final.state === 'waiting' && !inputs.autoDeploy) {
    core.notice(
      'The new version waits for a person to release it. Review it on the Overview page of the environment in the Apervia console.'
    )
    return
  }
  if (final.state !== 'ready') {
    throw new DeploymentError(explain(final))
  }
  core.info(
    final.release === undefined ? 'The release is ready.' : `Release ${final.release} is ready.`
  )
}

// A fresh token per poll. The platform verifies one on every request, and a
// token minted at the start of a long deployment would expire under it.
async function poll(inputs: Inputs, operation: string): Promise<Deployment> {
  return readStatus(inputs, operation, await requestToken())
}

function publish(inputs: Inputs, deployment: Deployment): void {
  // Set before any failure is raised, so a later step can still report which
  // release failed and why.
  core.setOutput('release', deployment.release ?? '')
  core.setOutput('digest', inputs.image.digest)
  core.setOutput('state', deployment.state)
}

function explain(deployment: Deployment): string {
  const detail = deployment.detail === undefined ? '' : ` ${deployment.detail}`
  if (deployment.state === 'superseded') {
    return `Another deployment replaced this one before it became ready.${detail}`
  }
  if (deployment.state === 'waiting') {
    return 'The platform held a deployment that did not ask for a hold. Look at the environment in the Apervia console.'
  }
  return `The release failed to become ready.${detail} Look at the environment in the Apervia console.`
}

class DeploymentError extends Error {}

try {
  await run()
} catch (error) {
  // An input, permission, platform or deployment failure is reported as
  // written, because each of those messages is for the user. Anything else is
  // reported by its message alone, and nothing on that path is allowed to
  // carry a credential.
  if (
    error instanceof InputError ||
    error instanceof TokenError ||
    error instanceof RequestError ||
    error instanceof TimeoutError ||
    error instanceof DeploymentError
  ) {
    core.setFailed(error.message)
  } else {
    core.setFailed(error instanceof Error ? error.message : 'The deployment failed.')
  }
}
