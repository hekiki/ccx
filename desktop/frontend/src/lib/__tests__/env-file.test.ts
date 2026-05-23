import { describe, expect, it } from 'vitest'
import { detectEnvNewline, getEnvFieldValue, parseEnvFile, serializeEnvFile } from '../env-file'

describe('parseEnvFile', () => {
  it('parses simple key=value', () => {
    const entries = parseEnvFile('PORT=3688\nENV=production')
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ type: 'pair', key: 'PORT', value: '3688' })
    expect(entries[1]).toMatchObject({ type: 'pair', key: 'ENV', value: 'production' })
  })

  it('handles export prefix', () => {
    const entries = parseEnvFile('export KEY=value')
    expect(entries[0]).toMatchObject({ type: 'pair', key: 'KEY', value: 'value', exportPrefix: true })
  })

  it('handles double-quoted values with escapes', () => {
    const entries = parseEnvFile('KEY="hello\\nworld\\"end"')
    expect(entries[0]).toMatchObject({ type: 'pair', key: 'KEY', value: 'hello\nworld"end', quote: 'double' })
  })

  it('handles single-quoted values as literals', () => {
    const entries = parseEnvFile("KEY='hello\\nworld'")
    expect(entries[0]).toMatchObject({ type: 'pair', key: 'KEY', value: 'hello\\nworld', quote: 'single' })
  })

  it('strips inline comments outside quotes', () => {
    const entries = parseEnvFile('KEY=value # this is a comment')
    expect(entries[0]).toMatchObject({ type: 'pair', key: 'KEY', value: 'value', inlineComment: ' # this is a comment' })
  })

  it('preserves inline comments inside double quotes', () => {
    const entries = parseEnvFile('KEY="value # not a comment"')
    expect(entries[0]).toMatchObject({ type: 'pair', key: 'KEY', value: 'value # not a comment', inlineComment: '' })
  })

  it('classifies empty lines and comments', () => {
    const entries = parseEnvFile('\n# comment\n\nKEY=val')
    expect(entries[0]).toMatchObject({ type: 'empty' })
    expect(entries[1]).toMatchObject({ type: 'comment', raw: '# comment' })
    expect(entries[2]).toMatchObject({ type: 'empty' })
    expect(entries[3]).toMatchObject({ type: 'pair', key: 'KEY' })
  })

  it('handles CRLF line endings', () => {
    const entries = parseEnvFile('A=1\r\nB=2')
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ key: 'A', value: '1' })
    expect(entries[1]).toMatchObject({ key: 'B', value: '2' })
  })

  it('handles unquoted values with special chars', () => {
    const entries = parseEnvFile('URL=http://localhost:3688/v1')
    expect(entries[0]).toMatchObject({ type: 'pair', key: 'URL', value: 'http://localhost:3688/v1', quote: 'none' })
  })
})

describe('getEnvFieldValue', () => {
  it('returns last occurrence (last-wins)', () => {
    const entries = parseEnvFile('KEY=first\nKEY=second')
    expect(getEnvFieldValue(entries, 'KEY')).toBe('second')
  })

  it('returns fallback for missing key', () => {
    const entries = parseEnvFile('OTHER=val')
    expect(getEnvFieldValue(entries, 'MISSING', 'default')).toBe('default')
  })

  it('returns empty string as default fallback', () => {
    const entries = parseEnvFile('OTHER=val')
    expect(getEnvFieldValue(entries, 'MISSING')).toBe('')
  })
})

describe('serializeEnvFile', () => {
  it('updates existing values preserving format', () => {
    const entries = parseEnvFile('PORT=3688\nENV=production')
    const result = serializeEnvFile(entries, { PORT: '4000', ENV: 'development' }, ['PORT', 'ENV'])
    expect(result).toContain('PORT=4000')
    expect(result).toContain('ENV=development')
  })

  it('preserves export prefix', () => {
    const entries = parseEnvFile('export KEY=old')
    const result = serializeEnvFile(entries, { KEY: 'new' }, ['KEY'])
    expect(result).toContain('export KEY=new')
  })

  it('preserves quote style', () => {
    const entries = parseEnvFile('KEY="old"')
    const result = serializeEnvFile(entries, { KEY: 'new value' }, ['KEY'])
    expect(result).toContain('KEY="new value"')
  })

  it('preserves inline comments', () => {
    const entries = parseEnvFile('KEY=value # comment')
    const result = serializeEnvFile(entries, { KEY: 'new' }, ['KEY'])
    expect(result).toContain('# comment')
  })

  it('appends new keys under managed block', () => {
    const entries = parseEnvFile('EXISTING=val')
    const result = serializeEnvFile(entries, { EXISTING: 'val', NEW_KEY: 'new' }, ['EXISTING', 'NEW_KEY'])
    expect(result).toContain('# Managed by CCX Desktop')
    expect(result).toContain('NEW_KEY=new')
  })

  it('preserves non-pair entries (comments, blanks)', () => {
    const entries = parseEnvFile('# header\n\nPORT=3688')
    const result = serializeEnvFile(entries, { PORT: '4000' }, ['PORT'])
    expect(result).toContain('# header')
  })
})

describe('detectEnvNewline', () => {
  it('detects LF', () => {
    expect(detectEnvNewline('a\nb')).toBe('\n')
  })

  it('detects CRLF', () => {
    expect(detectEnvNewline('a\r\nb')).toBe('\r\n')
  })
})
