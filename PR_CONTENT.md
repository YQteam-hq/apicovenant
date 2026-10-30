## What does this change?

This PR addresses several security improvements and bug fixes in apicovenant:

1. **Enhanced input validation** - Added comprehensive validation for API endpoints and configuration options to prevent injection attacks
2. **Improved file system security** - Added path validation to prevent directory traversal attacks in file operations
3. **YAML parser hardening** - Added resource limits and improved error handling to prevent DoS attacks
4. **Mock server security** - Enhanced host binding validation and methodNotAllowed handling
5. **Error handling improvements** - Better error messages without exposing internal details

## Why?

These changes address potential security vulnerabilities identified in the codebase:
- Input validation prevents malicious data from causing unexpected behavior
- File path validation prevents directory traversal attacks
- Resource limits in YAML parsing prevent DoS attacks
- Proper host binding validation ensures mock server only runs on localhost
- Improved error handling prevents information leakage

## Checklist

- [x] `node --test` passes
- [x] `npx tsc --noEmit` is clean  
- [x] `npm run release-check` passes
- [x] New behaviour has a test
- [x] `examples/shop.openapi.yaml` still produces **zero** findings
- [x] Documentation updated (`README.md`, `README.zh-CN.md`, `docs/`)
- [x] `CHANGELOG.md` updated
- [x] The runtime dependency count is still **zero**