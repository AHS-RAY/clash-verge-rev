import isFQDN from 'validator/es/lib/isFQDN'
import isIP from 'validator/es/lib/isIP'

import { isValidIpCidr } from './network'

export interface RuleTarget {
  type: 'DOMAIN-SUFFIX' | 'IP-CIDR' | 'IP-CIDR6'
  value: string
  noResolve: boolean
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
const BRACKETED_HOST = /^\[([^\]]+)\](?::\d+)?$/
const INVALID_CIDR_SUFFIX = /\/\d+$/

/** Accepts a bare host, a pasted URL, `host:port`, `*.host` and keeps the host only. */
const extractHost = (input: string): string => {
  let value = input.trim()

  if (HAS_SCHEME.test(value)) {
    try {
      value = new URL(value).hostname
    } catch {
      return ''
    }
  }

  const bracketed = BRACKETED_HOST.exec(value)
  if (bracketed) {
    return bracketed[1].toLowerCase()
  }

  value = value.split(/[/?#]/, 1)[0].replace(/^\*+\.?/, '')

  const parts = value.split(':')
  if (parts.length === 2 && /^\d+$/.test(parts[1])) {
    value = parts[0]
  }

  return value.replace(/^\.+/, '').replace(/\.$/, '').toLowerCase()
}

export const parseRuleTarget = (input: string): RuleTarget | null => {
  const raw = input.trim()
  if (!raw) return null

  if (isValidIpCidr(raw)) {
    return {
      type: raw.includes(':') ? 'IP-CIDR6' : 'IP-CIDR',
      value: raw,
      noResolve: true,
    }
  }

  // Only `address/prefix` input may carry a slash; anything else is a pasted path or a bad CIDR.
  if (!HAS_SCHEME.test(raw) && INVALID_CIDR_SUFFIX.test(raw)) return null

  const value = extractHost(raw)
  if (!value || value.includes('/')) return null

  if (isIP(value, 4)) {
    return { type: 'IP-CIDR', value: `${value}/32`, noResolve: true }
  }
  if (isIP(value, 6)) {
    return { type: 'IP-CIDR6', value: `${value}/128`, noResolve: true }
  }

  // Numeric or hex-only labels are failed IPs, not domains.
  if (/^[\d.]+$/.test(value) || /^[0-9a-f:]+$/.test(value)) return null

  if (!isFQDN(value, { require_tld: false })) return null

  return { type: 'DOMAIN-SUFFIX', value, noResolve: false }
}

export const formatRule = (target: RuleTarget, policy: string) =>
  `${target.type},${target.value},${policy}${target.noResolve ? ',no-resolve' : ''}`
