# Vercel Deployment Guide

This guide covers deploying the Stencil Generator to Vercel using GitHub integration.

## Prerequisites

- GitHub account
- Vercel account (free tier works)
- Repository pushed to GitHub

## Deployment Steps

### 1. Connect GitHub to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in
2. Click "Add New..." → "Project"
3. Click "Import Git Repository"
4. Select your GitHub account and authorize Vercel
5. Find the `stencil` repository and click "Import"

### 2. Configure Project

Vercel will auto-detect the Vite configuration. Verify these settings:

**Framework Preset:** Vite
**Build Command:** `npm run build`
**Output Directory:** `dist`
**Install Command:** `npm install`
**Node.js Version:** 18.x (or latest LTS)

### 3. Deploy

1. Click "Deploy"
2. Wait 2-3 minutes for build to complete
3. Your site will be live at `https://your-project-name.vercel.app`

## Automatic Deployments

### Production Deployments

Every push to the `main` or `master` branch triggers a production deployment automatically.

```bash
git push origin main
```

### Preview Deployments

Every pull request gets its own preview URL for testing before merging.

```bash
git checkout -b feature/my-feature
# Make changes
git push origin feature/my-feature
# Open PR on GitHub → automatic preview deployment
```

## GitHub Actions (Optional)

For more control, use the included GitHub Actions workflow:

### Setup Secrets

1. Go to your Vercel dashboard → Settings → Tokens
2. Create a new token and copy it
3. Go to GitHub repository → Settings → Secrets → Actions
4. Add these secrets:
   - `VERCEL_TOKEN`: Your Vercel API token
   - `VERCEL_ORG_ID`: From Vercel project settings
   - `VERCEL_PROJECT_ID`: From Vercel project settings

**Finding Org and Project IDs:**

```bash
# Install Vercel CLI
npm install -g vercel

# Link project
vercel link

# View project info
cat .vercel/project.json
```

The workflow will then deploy on every push/PR automatically.

## Custom Domain

### Add Custom Domain

1. Go to Vercel dashboard → your project → Settings → Domains
2. Add your domain (e.g., `stencilgen.com`)
3. Update DNS records:
   - Type: `A`, Name: `@`, Value: `76.76.21.21`
   - Type: `CNAME`, Name: `www`, Value: `cname.vercel-dns.com`
4. Wait for DNS propagation (5-60 minutes)
5. Vercel will automatically provision SSL certificate

## Environment Variables

If you need environment variables:

1. Vercel dashboard → your project → Settings → Environment Variables
2. Add variables:
   - Name: `VITE_API_KEY` (example)
   - Value: `your-api-key-here`
   - Environments: Production, Preview, Development

Access in code:
```javascript
const apiKey = import.meta.env.VITE_API_KEY;
```

## Performance Optimization

### Enabled by Default

- ✅ Code splitting (automatic chunking)
- ✅ Tree shaking (remove unused code)
- ✅ Minification (Terser)
- ✅ Brotli compression
- ✅ Edge caching (CDN)
- ✅ HTTP/2 + HTTP/3

### Custom Optimizations

**Edge Functions** (for API routes):
```javascript
// api/process.js
export const config = {
  runtime: 'edge',
};

export default function handler(req) {
  return new Response('Hello from Edge');
}
```

**Image Optimization** (for static images):
```html
<img src="/image.jpg" alt="..." loading="lazy" />
```

## Monitoring

### Analytics (Free)

Enable Vercel Analytics:

1. Dashboard → your project → Analytics
2. Toggle "Enable Web Analytics"
3. Add to your HTML:

```html
<script defer src="/_vercel/insights/script.js"></script>
```

### Speed Insights

For Core Web Vitals monitoring:

```bash
npm install @vercel/speed-insights
```

```javascript
import { injectSpeedInsights } from '@vercel/speed-insights';
injectSpeedInsights();
```

## Troubleshooting

### Build Fails

**Issue:** `npm ci` fails
**Solution:** Delete `package-lock.json` and commit:
```bash
rm package-lock.json
npm install
git add package-lock.json
git commit -m "Update package-lock.json"
git push
```

**Issue:** Module not found
**Solution:** Check imports use correct paths (case-sensitive)

**Issue:** WASM loading fails
**Solution:** Verify `assetsInclude` in `vite.config.js`

### Deployment Slow

**Issue:** Build takes >5 minutes
**Solution:** 
- Use `npm ci` instead of `npm install`
- Enable caching in GitHub Actions:
  ```yaml
  - uses: actions/setup-node@v3
    with:
      cache: 'npm'
  ```

### OpenCV.js Not Loading

**Issue:** OpenCV.js throws errors
**Solution:** Check browser console, ensure WASM is supported

**Fallback:** The app automatically falls back to custom implementations

## Rollback

### Revert to Previous Deployment

1. Dashboard → your project → Deployments
2. Find working deployment
3. Click "..." → "Promote to Production"

### Via Git

```bash
git revert HEAD
git push origin main
```

## Cost

### Free Tier Includes:
- Unlimited deployments
- 100GB bandwidth/month
- 6,000 build minutes/month
- Automatic SSL
- Preview deployments
- Web analytics

### Pro Tier ($20/month):
- 1TB bandwidth
- Custom domains (unlimited)
- Team collaboration
- Advanced analytics
- Password protection
- Priority support

## Best Practices

1. **Test locally first:** `npm run build && npm run preview`
2. **Use preview deployments:** Test in PR before merging
3. **Monitor analytics:** Check performance after each deploy
4. **Set up alerts:** Get notified of deployment failures
5. **Use semantic commits:** Clear commit messages help track changes
6. **Enable branch protection:** Require PR reviews before merge

## Support

- Vercel Docs: https://vercel.com/docs
- Vite Docs: https://vitejs.dev
- GitHub Issues: https://github.com/your-username/stencil/issues

## Quick Commands

```bash
# Local development
npm run dev

# Build production
npm run build

# Test production build
npm run preview

# Deploy to Vercel
vercel

# Deploy to production
vercel --prod

# View deployment logs
vercel logs

# View project info
vercel inspect
```

## Next Steps

After successful deployment:

1. ✅ Test all features in production
2. ✅ Set up custom domain (optional)
3. ✅ Enable analytics
4. ✅ Add to README badges
5. ✅ Share with users!

---

**Pro Tip:** Use Vercel's Preview Deployments to test changes safely before deploying to production. Every PR gets its own URL!
