import { describe, it, expect } from 'vitest'
import { buildSetCookie, clearCookie, readCookie, ID_TOKEN_COOKIE } from './cookies'

describe('cookies', () => {
  it('builds a Set-Cookie string with HttpOnly/Secure/SameSite=Strict/Path=/api always present', () => {
    const cookie = buildSetCookie('rl_id_token', 'abc.def.ghi', { maxAgeSeconds: 900 })
    expect(cookie).toBe('rl_id_token=abc.def.ghi; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=900')
  })

  it('clears a cookie with an empty value and Max-Age=0', () => {
    expect(clearCookie('rl_id_token')).toBe('rl_id_token=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0')
  })

  it('reads a cookie value out of the Lambda Function URL v2 cookies array', () => {
    const cookies = ['other=1', `${ID_TOKEN_COOKIE}=abc.def.ghi`, 'third=2']
    expect(readCookie(cookies, ID_TOKEN_COOKIE)).toBe('abc.def.ghi')
  })

  it('returns undefined when the cookie is absent or the array itself is undefined', () => {
    expect(readCookie(['other=1'], ID_TOKEN_COOKIE)).toBeUndefined()
    expect(readCookie(undefined, ID_TOKEN_COOKIE)).toBeUndefined()
  })
})
