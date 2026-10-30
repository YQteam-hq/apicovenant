/**
 * Input validation framework for secure data handling
 */

export interface ValidationConstraints {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  allowedValues?: string[];
  required?: boolean;
  pattern?: RegExp;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Validate input value against constraints
 */
export function validateInput(value: unknown, type: 'string' | 'number' | 'integer' | 'file', constraints: ValidationConstraints = {}): ValidationResult {
  const errors: string[] = [];
  
  // Check if value is required and missing
  if (constraints.required && (value === undefined || value === null || value === '')) {
    errors.push('Value is required');
    return { isValid: false, errors };
  }
  
  // Skip validation if value is empty and not required
  if (value === undefined || value === null || value === '') {
    return { isValid: true, errors };
  }
  
  // Convert to string for validation
  const stringValue = String(value);
  const numberValue = Number(value);
  
  // Type-specific validation
  switch (type) {
    case 'string':
      validateString(stringValue, constraints, errors);
      break;
    case 'number':
      validateNumber(numberValue, stringValue, constraints, errors);
      break;
    case 'integer':
      validateInteger(numberValue, stringValue, constraints, errors);
      break;
    case 'file':
      validateFile(stringValue, constraints, errors);
      break;
  }
  
  // Check allowed values
  if (constraints.allowedValues && !constraints.allowedValues.includes(stringValue)) {
    errors.push(`Value must be one of: ${constraints.allowedValues.join(', ')}`);
  }
  
  // Check pattern
  if (constraints.pattern && !constraints.pattern.test(stringValue)) {
    errors.push('Value does not match required pattern');
  }
  
  return { isValid: errors.length === 0, errors };
}

function validateString(value: string, constraints: ValidationConstraints, errors: string[]): void {
  if (constraints.minLength && value.length < constraints.minLength) {
    errors.push(`Value must be at least ${constraints.minLength} characters long`);
  }
  
  if (constraints.maxLength && value.length > constraints.maxLength) {
    errors.push(`Value must be at most ${constraints.maxLength} characters long`);
  }
}

function validateNumber(value: number, stringValue: string, constraints: ValidationConstraints, errors: string[]): void {
  if (Number.isNaN(value)) {
    errors.push('Value must be a valid number');
    return;
  }
  
  if (constraints.min !== undefined && value < constraints.min) {
    errors.push(`Value must be at least ${constraints.min}`);
  }
  
  if (constraints.max !== undefined && value > constraints.max) {
    errors.push(`Value must be at most ${constraints.max}`);
  }
  
  // Check if it's a valid number (not NaN or Infinity)
  if (!Number.isFinite(value)) {
    errors.push('Value must be a finite number');
  }
}

function validateInteger(value: number, stringValue: string, constraints: ValidationConstraints, errors: string[]): void {
  if (Number.isNaN(value)) {
    errors.push('Value must be a valid number');
    return;
  }
  
  // Check if it's an integer
  if (!Number.isInteger(value)) {
    errors.push('Value must be an integer');
  }
  
  if (constraints.min !== undefined && value < constraints.min) {
    errors.push(`Value must be at least ${constraints.min}`);
  }
  
  if (constraints.max !== undefined && value > constraints.max) {
    errors.push(`Value must be at most ${constraints.max}`);
  }
  
  if (!Number.isFinite(value)) {
    errors.push('Value must be a finite number');
  }
}

function validateFile(value: string, constraints: ValidationConstraints, errors: string[]): void {
  // Basic file path validation
  if (value.includes('..')) {
    errors.push('File path contains invalid directory traversal');
  }
  
  if (value.includes('/') || value.includes('\\')) {
    // Check for path traversal attempts
    const normalizedPath = value.replace(/\\/g, '/');
    if (normalizedPath.includes('../') || normalizedPath.includes('/..')) {
      errors.push('File path contains directory traversal');
    }
  }
  
  // Check file extension if specified
  if (constraints.allowedValues) {
    const extension = value.split('.').pop()?.toLowerCase();
    if (extension && !constraints.allowedValues.includes(extension)) {
      errors.push(`File extension must be one of: ${constraints.allowedValues.join(', ')}`);
    }
  }
}

/**
 * Validate configuration options
 */
export function validateConfig(config: Record<string, unknown>, schema: Record<string, ValidationConstraints>): ValidationResult {
  const errors: string[] = [];
  
  for (const [key, constraints] of Object.entries(schema)) {
    const result = validateInput(config[key], 'string', constraints);
    if (!result.isValid) {
      errors.push(`${key}: ${result.errors.join(', ')}`);
    }
  }
  
  return { isValid: errors.length === 0, errors };
}

/**
 * Safe parsing with validation
 */
export function safeParseInteger(value: string | undefined, fallback: number, label: string, min?: number, max?: number): number {
  if (value === undefined) return fallback;
  
  const result = validateInput(value, 'integer', { min, max });
  if (!result.isValid) {
    throw new Error(`${label}: ${result.errors.join(', ')}`);
  }
  
  return Number.parseInt(value, 10);
}

/**
 * Validate host binding to prevent security issues
 */
export function validateHostBinding(host: string): void {
  const allowedHosts = ['127.0.0.1', 'localhost'];
  if (!allowedHosts.includes(host)) {
    throw new Error(`Host binding "${host}" is not allowed. Only localhost bindings are permitted.`);
  }
}

/**
 * Validate port number
 */
export function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`Port ${port} is invalid. Port must be between 1024 and 65535.`);
  }
}

/**
 * Mock server configuration schema
 */
export const MOCK_SERVER_CONFIG_SCHEMA = {
  host: { required: false, allowedValues: ['127.0.0.1', 'localhost'] },
  port: { required: false, type: 'integer' as const, min: 1024, max: 65535 },
  latency: { required: false, type: 'integer' as const, min: 0, max: 30000 },
  errorLatency: { required: false, type: 'integer' as const, min: 0, max: 30000 },
};

/**
 * Validate mock server configuration
 */
export function validateMockServerConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  
  // Validate host binding
  if (config.host !== undefined) {
    const hostResult = validateInput(config.host, 'string', { allowedValues: ['127.0.0.1', 'localhost'] });
    if (!hostResult.isValid) {
      errors.push(`host: ${hostResult.errors.join(', ')}`);
    }
  }
  
  // Validate port
  if (config.port !== undefined) {
    const portResult = validateInput(config.port, 'integer', { min: 1024, max: 65535 });
    if (!portResult.isValid) {
      errors.push(`port: ${portResult.errors.join(', ')}`);
    }
  }
  
  // Validate latency
  if (config.latency !== undefined) {
    const latencyResult = validateInput(config.latency, 'integer', { min: 0, max: 30000 });
    if (!latencyResult.isValid) {
      errors.push(`latency: ${latencyResult.errors.join(', ')}`);
    }
  }
  
  // Validate errorLatency
  if (config.errorLatency !== undefined) {
    const errorLatencyResult = validateInput(config.errorLatency, 'integer', { min: 0, max: 30000 });
    if (!errorLatencyResult.isValid) {
      errors.push(`errorLatency: ${errorLatencyResult.errors.join(', ')}`);
    }
  }
  
  return { isValid: errors.length === 0, errors };
}

/**
 * API configuration schema
 */
export const API_CONFIG_SCHEMA = {
  baseUrl: { required: true, pattern: /^https?:\/\/.+$/ },
  timeout: { required: false, type: 'integer' as const, min: 1000, max: 30000 },
  retries: { required: false, type: 'integer' as const, min: 0, max: 5 },
  headers: { required: false, pattern: /^[a-zA-Z0-9-]+:.+$/ },
};

/**
 * Validate API configuration
 */
export function validateApiConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  
  // Validate base URL
  if (config.baseUrl !== undefined) {
    const urlResult = validateInput(config.baseUrl, 'string', { required: true, pattern: /^https?:\/\/.+$/ });
    if (!urlResult.isValid) {
      errors.push(`baseUrl: ${urlResult.errors.join(', ')}`);
    }
  }
  
  // Validate timeout
  if (config.timeout !== undefined) {
    const timeoutResult = validateInput(config.timeout, 'integer', { min: 1000, max: 30000 });
    if (!timeoutResult.isValid) {
      errors.push(`timeout: ${timeoutResult.errors.join(', ')}`);
    }
  }
  
  // Validate retries
  if (config.retries !== undefined) {
    const retriesResult = validateInput(config.retries, 'integer', { min: 0, max: 5 });
    if (!retriesResult.isValid) {
      errors.push(`retries: ${retriesResult.errors.join(', ')}`);
    }
  }
  
  // Validate headers format
  if (config.headers !== undefined && typeof config.headers === 'object') {
    for (const [key, value] of Object.entries(config.headers as Record<string, string>)) {
      if (typeof value !== 'string') {
        errors.push(`headers.${key}: Header value must be a string`);
        continue;
      }
      
      // Basic header validation
      if (!/^[a-zA-Z0-9-]+$/.test(key)) {
        errors.push(`headers.${key}: Header name contains invalid characters`);
      }
      
      // Check for common security headers
      if (key.toLowerCase() === 'x-forwarded-for' || key.toLowerCase() === 'x-real-ip') {
        errors.push(`headers.${key}: Setting proxy headers is not allowed`);
      }
    }
  }
  
  return { isValid: errors.length === 0, errors };
}

/**
 * Security validation for file operations
 */
export function validateFilePath(filePath: string, allowedDirectory?: string): void {
  const resolvedPath = require('path').resolve(filePath);
  
  // Check for directory traversal
  if (filePath.includes('..')) {
    throw new Error(`File path "${filePath}" contains directory traversal`);
  }
  
  // Check if path is within allowed directory
  if (allowedDirectory) {
    const allowedDir = require('path').resolve(allowedDirectory);
    if (!resolvedPath.startsWith(allowedDir)) {
      throw new Error(`File path "${filePath}" is outside allowed directory`);
    }
  }
  
  // Check for potentially dangerous file extensions
  const dangerousExtensions = ['.php', '.js', '.exe', '.bat', '.sh', '.ps1'];
  const extension = require('path').extname(filePath).toLowerCase();
  if (dangerousExtensions.includes(extension)) {
    throw new Error(`File extension "${extension}" is not allowed`);
  }
}

/**
 * Environment variable validation
 */
export function validateEnvironmentVariable(name: string, value: string, constraints: ValidationConstraints = {}): ValidationResult {
  const errors: string[] = [];
  
  // Validate variable name
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
    errors.push('Environment variable name must contain only uppercase letters, numbers and underscores');
    return { isValid: false, errors };
  }
  
  // Validate variable value
  const valueResult = validateInput(value, 'string', constraints);
  if (!valueResult.isValid) {
    errors.push(`Environment variable value is invalid: ${valueResult.errors.join(', ')}`);
  }
  
  // Check for sensitive data patterns
  const sensitivePatterns = [
    /password/i,
    /secret/i,
    /key/i,
    /token/i,
    /credential/i,
  ];
  
  for (const pattern of sensitivePatterns) {
    if (pattern.test(value)) {
      errors.push('Environment variable value contains sensitive information');
      break;
    }
  }
  
  return { isValid: errors.length === 0, errors };
}