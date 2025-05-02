import { extractPort } from '../extractPort'
import { Result } from '../result'

describe('extractPort', () => {
  it('should extract the port number from a localhost URL with port', () => {
    const uri = 'http://localhost:3000'
    const result = extractPort(uri)
    
    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.value).toBe(3000)
    }
  })

  it('should return undefined for a localhost URL without port', () => {
    const uri = 'http://localhost'
    const result = extractPort(uri)
    
    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.value).toBeUndefined()
    }
  })

  it('should fail for a non-localhost URL', () => {
    const uri = 'http://example.com:3000'
    const result = extractPort(uri)
    
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.error.message).toBe('Invalid URL format')
    }
  })

  it('should fail for a localhost URL with an invalid port number', () => {
    const uri = 'http://localhost:99999'
    const result = extractPort(uri)
    
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.error.message).toBe('Not a valid port: 99999')
    }
  })

  it('should fail for a localhost URL with a negative port number', () => {
    const uri = 'http://localhost:-1'
    const result = extractPort(uri)
    
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.error.message).toBe('Invalid URL format')
    }
  })

  it('should fail for a localhost URL with a non-numeric port', () => {
    const uri = 'http://localhost:abc'
    const result = extractPort(uri)
    
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.error.message).toBe('Invalid URL format')
    }
  })

  it('should fail for URLs with incorrect protocol', () => {
    const uri = 'https://localhost:3000'
    const result = extractPort(uri)
    
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.error.message).toBe('Invalid URL format')
    }
  })

  it('should fail for non-URL strings', () => {
    const uri = 'not a url'
    const result = extractPort(uri)
    
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.error.message).toBe('Invalid URL format')
    }
  })

  it('should handle boundary value 0 for port', () => {
    const uri = 'http://localhost:0'
    const result = extractPort(uri)
    
    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.value).toBe(0)
    }
  })

  it('should handle boundary value 65535 for port', () => {
    const uri = 'http://localhost:65535'
    const result = extractPort(uri)
    
    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.value).toBe(65535)
    }
  })
})