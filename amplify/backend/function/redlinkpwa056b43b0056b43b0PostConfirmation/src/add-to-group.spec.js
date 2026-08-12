import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import {
  CognitoIdentityProviderClient,
  GetGroupCommand,
  AdminAddUserToGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import { handler } from './add-to-group.js'

// Regression coverage for fix #4 on branch fix/data-model-risks: add-to-group.js used to
// swallow a failed AdminAddUserToGroupCommand with only a console.error, leaving the Cognito
// user CONFIRMED but never attached to a group (Veterinarians/Owners) — confirmed, but with no
// authorization and no signal anywhere. It must now re-throw so the failure surfaces as a
// Lambda invocation error (CloudWatch) and as an error on the client's ConfirmSignUp call.
//
// add-to-group.js is a plain CommonJS module (require/exports.x=, no ESM syntax) with no other
// import/export syntax, so Vite/Vitest loads it — and its `require('@aws-sdk/...')` call — via
// Node's own module resolution rather than through Vite's transform graph. That makes a
// vi.mock('@aws-sdk/client-cognito-identity-provider', factory) silently ineffective here: the
// handler ends up using the *real* SDK class regardless of the mock factory. '@aws-sdk/client-
// cognito-identity-provider' is installed as a devDependency (never used at runtime in
// production — the deployed Lambda gets its dependencies bundled separately at `amplify push`
// time) purely so both this spec and add-to-group.js resolve to the *same* real class, letting
// us stub CognitoIdentityProviderClient.prototype.send directly instead of trying to mock the
// module. This also means real command construction (GetGroupCommand, etc.) is exercised as-is;
// only the network call itself is stubbed.

const sendSpy = vi.spyOn(CognitoIdentityProviderClient.prototype, 'send')

afterAll(() => {
  sendSpy.mockRestore()
})

function buildEvent(profile = 'vet') {
  return {
    userPoolId: 'pool-123',
    userName: 'user-abc',
    request: {
      userAttributes: {
        'custom:profile': profile,
      },
    },
  }
}

describe('PostConfirmation add-to-group handler', () => {
  beforeEach(() => {
    sendSpy.mockReset()
  })

  it('re-throws (does not swallow) when AdminAddUserToGroupCommand rejects', async () => {
    sendSpy.mockImplementation((command) => {
      if (command instanceof GetGroupCommand) return Promise.resolve({})
      if (command instanceof AdminAddUserToGroupCommand) {
        return Promise.reject(new Error('AccessDenied: cannot add user to group'))
      }
      return Promise.resolve({})
    })

    await expect(handler(buildEvent('vet'))).rejects.toThrow(
      'AccessDenied: cannot add user to group',
    )
  })

  it('resolves and returns the event when the group already exists and the user is added successfully', async () => {
    sendSpy.mockResolvedValue({})

    const event = buildEvent('owner')
    await expect(handler(event)).resolves.toBe(event)

    expect(sendSpy).toHaveBeenCalledWith(expect.any(GetGroupCommand))
    expect(sendSpy).toHaveBeenCalledWith(expect.any(AdminAddUserToGroupCommand))
  })

  it('creates the group first when GetGroupCommand fails, then still re-throws if AdminAddUserToGroupCommand ultimately fails', async () => {
    sendSpy.mockImplementation((command) => {
      if (command instanceof GetGroupCommand) return Promise.reject(new Error('not found'))
      if (command instanceof AdminAddUserToGroupCommand) {
        return Promise.reject(new Error('still broken after group creation'))
      }
      // CreateGroupCommand
      return Promise.resolve({})
    })

    await expect(handler(buildEvent('vet'))).rejects.toThrow('still broken after group creation')
  })

  it('does not call the SDK and returns the event untouched for an unrecognized profile', async () => {
    const event = buildEvent('not-a-real-profile')
    await expect(handler(event)).resolves.toBe(event)
    expect(sendSpy).not.toHaveBeenCalled()
  })
})
