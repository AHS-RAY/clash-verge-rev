import { describe, expect, test } from 'vitest'

import { formatRule, parseRuleTarget } from './quick-rule'

describe('parseRuleTarget', () => {
  test('turns domains into suffix rules', () => {
    expect(parseRuleTarget('example.com')).toEqual({
      type: 'DOMAIN-SUFFIX',
      value: 'example.com',
      noResolve: false,
    })
    expect(parseRuleTarget('*.Example.COM')).toMatchObject({
      type: 'DOMAIN-SUFFIX',
      value: 'example.com',
    })
    expect(parseRuleTarget('localhost')).toMatchObject({
      type: 'DOMAIN-SUFFIX',
      value: 'localhost',
    })
  })

  test('keeps the host from pasted URLs and hosts with ports', () => {
    expect(parseRuleTarget('https://www.example.com/path?q=1')).toMatchObject({
      type: 'DOMAIN-SUFFIX',
      value: 'www.example.com',
    })
    expect(parseRuleTarget('example.com:8080')).toMatchObject({
      type: 'DOMAIN-SUFFIX',
      value: 'example.com',
    })
  })

  test('turns IPs into CIDR rules that skip DNS resolution', () => {
    expect(parseRuleTarget('1.2.3.4')).toEqual({
      type: 'IP-CIDR',
      value: '1.2.3.4/32',
      noResolve: true,
    })
    expect(parseRuleTarget('1.2.3.4:443')).toMatchObject({
      type: 'IP-CIDR',
      value: '1.2.3.4/32',
    })
    expect(parseRuleTarget('2001:db8::1')).toEqual({
      type: 'IP-CIDR6',
      value: '2001:db8::1/128',
      noResolve: true,
    })
    expect(parseRuleTarget('[2001:db8::1]:443')).toMatchObject({
      type: 'IP-CIDR6',
      value: '2001:db8::1/128',
    })
  })

  test('keeps explicit CIDR input', () => {
    expect(parseRuleTarget('10.0.0.0/8')).toEqual({
      type: 'IP-CIDR',
      value: '10.0.0.0/8',
      noResolve: true,
    })
    expect(parseRuleTarget('2001:db8::/32')).toMatchObject({
      type: 'IP-CIDR6',
      value: '2001:db8::/32',
    })
  })

  test('rejects input that is neither a host nor an address', () => {
    expect(parseRuleTarget('')).toBeNull()
    expect(parseRuleTarget('not a domain')).toBeNull()
    expect(parseRuleTarget('999.999.999.999')).toBeNull()
    expect(parseRuleTarget('1.2.3.4/99')).toBeNull()
  })
})

describe('formatRule', () => {
  test('writes the rule in mihomo syntax', () => {
    expect(
      formatRule(
        { type: 'DOMAIN-SUFFIX', value: 'example.com', noResolve: false },
        'DIRECT',
      ),
    ).toBe('DOMAIN-SUFFIX,example.com,DIRECT')
    expect(
      formatRule(
        { type: 'IP-CIDR', value: '1.2.3.4/32', noResolve: true },
        '🚀 节点选择',
      ),
    ).toBe('IP-CIDR,1.2.3.4/32,🚀 节点选择,no-resolve')
  })
})
