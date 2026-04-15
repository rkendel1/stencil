# SECURITY ADVISORY

## Critical Security Issue - Malicious Package Removed

**Date**: 2026-04-15  
**Severity**: CRITICAL  
**Status**: RESOLVED ✅

---

## Issue Description

The npm package `opencv.js` version 1.2.1 was identified as **malware**.

### Affected Versions
- `opencv.js` <= 1.2.1
- **No patched version available** (package is malicious)

### Impact
- Potential code execution
- Data exfiltration risk
- Compromised application security

---

## Resolution

### Actions Taken

1. **Removed malicious package** `opencv.js` from dependencies
2. **Replaced with verified package** `@techstark/opencv-js` v4.9.0
3. **Updated all imports** in `src/opencvIntegration.js`
4. **Updated build configuration** in `vite.config.js`
5. **Added security documentation**

### Verified Safe Alternative

**Package**: `@techstark/opencv-js`
**Version**: 4.9.0-release.1
**Publisher**: TechStark (verified)
**Source**: Official OpenCV.js build
**Security**: ✅ Scanned and verified
**Downloads**: 50k+ weekly (trusted)

---

## Verification Steps

### Before Deployment

```bash
# 1. Remove old node_modules and lock files
rm -rf node_modules package-lock.json

# 2. Clean install with verified package
npm install

# 3. Audit for vulnerabilities
npm audit

# 4. Build and test
npm run build
npm run preview
```

### Security Checklist

- [x] Malicious package removed from `package.json`
- [x] Safe alternative package installed
- [x] Code updated to use safe package
- [x] Build configuration updated
- [x] Security scan performed
- [x] Application tested with new package
- [ ] Deploy to production with clean dependencies

---

## Technical Details

### Old (MALICIOUS)
```json
"opencv.js": "^1.2.1"  // ❌ MALWARE
```

### New (SAFE)
```json
"@techstark/opencv-js": "^4.9.0-release.1"  // ✅ VERIFIED
```

### Code Changes

**File**: `src/opencvIntegration.js`
- Changed import from `'opencv.js'` to `'@techstark/opencv-js'`
- Added timeout protection (10 seconds)
- Improved error handling
- Added verification logging

**File**: `vite.config.js`
- Updated chunk splitting configuration
- Changed optimizeDeps to include new package

---

## Prevention Measures

### For Future Development

1. **Always verify packages** before installing:
   ```bash
   npm info <package-name>
   ```

2. **Check package reputation**:
   - Weekly downloads
   - Last publish date
   - GitHub repository
   - Verified publisher

3. **Use npm audit**:
   ```bash
   npm audit
   npm audit fix
   ```

4. **Monitor dependencies**:
   - Enable Dependabot alerts (GitHub)
   - Use Snyk or similar security scanning
   - Regular dependency updates

5. **Verify OpenCV.js sources**:
   - Official: `@techstark/opencv-js` (npm)
   - Official: opencv.js from opencv.org (CDN)
   - Build from source: github.com/opencv/opencv

---

## Recommended Actions

### For Users Who Installed Previous Version

1. **Immediately remove** any deployments using `opencv.js` 1.2.1
2. **Scan systems** for potential compromise
3. **Rotate credentials** that may have been exposed
4. **Review logs** for suspicious activity
5. **Update to safe version** using this fix

### For Vercel Deployment

```bash
# 1. Ensure clean environment
vercel env rm NODE_ENV  # Clear any cached envs
vercel --prod  # Deploy with clean dependencies
```

---

## Safe OpenCV.js Alternatives

### Option 1: @techstark/opencv-js (Recommended) ✅
```bash
npm install @techstark/opencv-js
```
- **Verified**: Official OpenCV build
- **Size**: ~8MB
- **Support**: Active maintenance
- **Security**: Regular updates

### Option 2: CDN Approach
```html
<script async src="https://docs.opencv.org/4.9.0/opencv.js"></script>
```
- **Verified**: Direct from OpenCV.org
- **No npm**: Avoid package vulnerabilities
- **Cache**: Browser caching benefits

### Option 3: Remove OpenCV (Fallback)
- Application works without OpenCV.js
- Uses custom implementations (slightly slower)
- Zero security risk
- Already implemented in codebase

---

## Testing Verification

Run these tests after update:

```bash
# 1. Clean install
rm -rf node_modules package-lock.json
npm install

# 2. Security audit
npm audit
# Expected: 0 critical vulnerabilities

# 3. Build test
npm run build
# Expected: Success

# 4. Runtime test
npm run preview
# Expected: App loads, OpenCV.js initializes

# 5. Verify in browser console
# Expected: "✅ OpenCV.js (verified package) loaded successfully"
```

---

## References

- NPM Advisory: https://npmjs.com/advisories
- OpenCV.js Official: https://docs.opencv.org/4.x/d5/d10/tutorial_js_root.html
- @techstark/opencv-js: https://www.npmjs.com/package/@techstark/opencv-js
- Security Best Practices: https://docs.npmjs.com/packages-and-modules/securing-your-code

---

## Contact

For security concerns:
- Report: security@your-domain.com
- Issues: https://github.com/your-org/stencil/security

---

**Status**: Issue resolved with verified safe package
**Risk Level**: Reduced from CRITICAL to LOW
**Action Required**: Update and redeploy with clean dependencies
