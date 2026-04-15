# StencilGen - Professional Multi-Layer Airbrush Stencil Generator

A professional-grade web application for generating multi-layer airbrush stencils from images. Designed for creating **sequential airbrush layers** that can be cut from stencil material and airbrushed one after the next to build up photorealistic images.

## Perfect For

- **T-shirt Airbrushing** - Custom apparel designs
- **Canvas Artwork** - Portrait art and fine art prints
- **Automotive Custom Paint** - Car hood art, motorcycle tanks, helmets
- **Murals** - Large-scale airbrush wall art
- **Any Sequential Airbrush Application**

Each layer is designed to be **cut from vinyl, mylar, or acetate** and airbrushed in sequence to progressively build up the final image.

## Features

### Core Capabilities
- **Multi-Layer Segmentation**: K-means, adaptive thresholding, or posterization optimized for airbrush layer separation
- **Professional Vectorization**: Powered by Potrace for industry-standard Bezier curves suitable for cutting
- **Advanced Image Processing**: OpenCV.js integration for optimized operations
- **AI-Powered Airbrush Evaluation**: Groq Vision API analyzes layer sequencing, overspray protection, and airbrush build-up quality
- **Intelligent Auto-Fix**: Automatic island detection and bridge generation for cuttable stencils
- **Production-Ready Output**: SVG, PDF, PNG export with registration marks for accurate layer alignment

### Image Processing Pipeline
1. **Preprocessing**: Bilateral filtering, histogram normalization, edge sharpening
2. **B&W Conversion**: Sigmoid contrast compression for pure black & white
3. **Segmentation**: K-means clustering, adaptive thresholding, or posterization
4. **Mask Building**: Binary mask generation with morphological cleanup
5. **Validation & Auto-Fix**: Island detection, bridge generation, connectivity analysis
6. **Vectorization**: Marching squares + Douglas-Peucker simplification
7. **AI Structural Review**: Optional AI-powered airbrush compatibility evaluation
8. **Assemble Layers**: Shaded composite generation (when AI enabled)
9. **AI Composite Evaluation**: Groq Vision API analysis for airbrush sequencing and quality (when AI enabled)

## Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

The application will open at `http://localhost:8080`

## Deployment

### Vercel Deployment (Recommended)

#### Option 1: GitHub Integration (Easiest)
1. Push your code to GitHub
2. Go to [vercel.com](https://vercel.com) and sign in
3. Click "Import Project"
4. Select your `stencil` repository
5. Vercel will auto-detect the Vite configuration
6. Click "Deploy"

**Automatic Deployments**: Every push to `main` triggers a production deployment. Pull requests get preview deployments.

#### Option 2: Vercel CLI

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy (first time - follow prompts)
vercel

# Deploy to production
vercel --prod
```

#### Option 3: GitHub Actions (Already Configured)

The repository includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) for automatic deployments.

**Setup Required**:
1. Go to your Vercel dashboard → Settings → Tokens
2. Create a new token
3. Add these secrets to your GitHub repository (Settings → Secrets):
   - `VERCEL_TOKEN`: Your Vercel API token
   - `VERCEL_ORG_ID`: Found in Vercel project settings
   - `VERCEL_PROJECT_ID`: Found in Vercel project settings

Push to `main` or open a PR, and GitHub Actions will handle deployment automatically.

### Environment Configuration

#### Groq AI Integration (Optional)

To enable AI-powered composite evaluation:

1. Sign up for a Groq API key at [console.groq.com](https://console.groq.com/)
2. In Vercel dashboard → Settings → Environment Variables:
   - **Name**: `GROQ_API_KEY`
   - **Value**: Your Groq API key
   - **Environment**: All (Production, Preview, Development)
3. Redeploy your application

The AI evaluation feature will automatically activate when the API key is configured.

**What AI Evaluation Provides:**
- **Airbrush sequencing analysis** - Ensures layers build up properly when airbrushed in order
- **Overspray prevention** - Detects gaps where paint can bleed through
- **Layer progression validation** - Confirms proper dark-to-light (or light-to-dark) build-up
- Fidelity comparison between original and reconstructed composite
- Layer balance analysis and recommendations
- Edge consistency detection (clean transitions for airbrushing)
- Structural correctness validation (bridges won't tear during handling)
- Cut feasibility assessment (layers thick enough to mask effectively)
- Aesthetic coherence scoring

#### Production Configuration

For production deployment, the following are pre-configured:
- ✅ Vite build optimization with code splitting
- ✅ Asset caching headers (1 year for immutable assets)
- ✅ WASM support for OpenCV.js
- ✅ Security headers (XSS, Frame, Content-Type)
- ✅ Clean URLs and SPA routing
- ✅ Serverless functions for secure API key management

## Technology Stack

### Core
- **Vite**: Modern build tool with HMR and optimized bundling
- **ES Modules**: Native JavaScript modules for better tree-shaking

### Image Processing
- **OpenCV.js** (~8MB WASM): Industrial-strength computer vision
  - Gaussian blur, morphological operations
  - Canny edge detection, distance transforms
  - 2-5x faster than custom implementations
  
- **Potrace** (~100KB): Professional bitmap-to-vector tracing
  - Industry-standard Bezier curve output
  - Optimized curve simplification
  - Better edge smoothing than marching squares
  
- **Jimp** (~500KB): Pure JavaScript image manipulation
  - Format conversion, resizing, rotation
  - Used for preprocessing and thumbnails

### Custom Algorithms
- K-means++ clustering
- Otsu's optimal thresholding
- Bilateral filtering
- Morphological closing
- Connected component labeling
- Marching squares vectorization
- Douglas-Peucker simplification

## Project Structure

```
stencil/
├── src/
│   ├── app.js                    # Main application logic
│   ├── imageLoader.js            # Image loading & preprocessing
│   ├── kmeans.js                 # Clustering & thresholding
│   ├── pipeline.js               # Main processing pipeline
│   ├── validator.js              # Structural validation
│   ├── vectorizer.js             # Path generation
│   ├── exporter.js               # SVG/PDF/PNG export
│   ├── ui.js                     # User interface
│   ├── opencvIntegration.js      # OpenCV.js wrapper
│   ├── potraceIntegration.js     # Potrace wrapper
│   ├── compositeAssembler.js     # Shaded composite generation
│   └── aiEvaluation.js           # Groq AI integration
├── api/
│   └── get-groq-key.js           # Vercel serverless function
├── styles/
│   └── main.css                  # Application styles
├── index.html                    # Entry point
├── vite.config.js                # Vite configuration
├── vercel.json                   # Vercel deployment config
├── package.json                  # Dependencies & scripts
└── .github/workflows/deploy.yml  # CI/CD automation
```

## Usage

### Workflow
1. **Upload Image**: Drag & drop, file picker, or URL
2. **Configure Settings**:
   - Layer count (2-12) - typically 3-6 for airbrush work
   - Segmentation method (K-means recommended for portraits)
   - Smoothing level (0-5)
   - Simplification tolerance
   - Auto-fix islands (recommended - creates bridges for structural integrity)
   - AI Evaluation (analyzes airbrush compatibility - requires Groq API key)
   - Bridge thickness (thicker for vinyl, thinner for acetate)
3. **Generate**: Click "Generate Layers"
4. **Review**: Check layers in sequence, toggle visibility, verify layer progression
5. **Export**: Download as SVG (for cutting), PDF (for printing), or PNG (for preview)

### For Airbrush Artists
The generated layers are designed to be used sequentially:
1. **Export SVG** - Send to vinyl cutter or cut by hand
2. **Cut Each Layer** - Separate stencil material for each layer
3. **Airbrush Layer 1** - Usually background/darkest color
4. **Align & Airbrush Layer 2** - Use registration marks for precise alignment
5. **Continue Through Layers** - Each layer adds detail and tonal variation
6. **Final Result** - Photorealistic airbrush art built up from multiple layers

**Example:** See [multi-layer airbrush stencil examples](https://github.com/user-attachments/assets/1704e6c7-fc49-405e-90f5-3417b942b679) showing the progression from base layer through highlights.

## Performance

- **Target**: <5 seconds for 1920×1080 images
- **Optimization**: 
  - Bilateral filtering: O(n) with spatial windowing
  - K-means: Subsampling for large images (>80k pixels)
  - Vectorization: Efficient marching squares + DP simplification
  - Build: Code splitting, tree-shaking, minification

## Browser Support

- Chrome 90+ ✅
- Firefox 88+ ✅
- Safari 14+ ✅
- Edge 90+ ✅

## License

MIT

## Contributing

Contributions welcome! Please ensure:
- Code follows existing style
- New algorithms include documentation
- Performance-critical code is optimized
- Changes don't break existing tests

## Roadmap

### Phase 1: Testing (High Priority)
- [ ] Vitest setup for unit tests
- [ ] Playwright for E2E browser tests
- [ ] Visual regression tests with pixelmatch
- [ ] Performance benchmarking suite

### Phase 2: Algorithm Improvements
- [ ] Bradley adaptive thresholding
- [ ] A* pathfinding for intelligent bridges
- [ ] Chaikin curve smoothing
- [ ] Multi-scale segmentation

### Phase 3: Advanced Features
- [ ] Web Worker parallelization
- [ ] Intelligent layer ordering
- [ ] Curved bridges (Catmull-Rom splines)
- [ ] Real-time preview with partial processing

### Phase 4: UX Enhancements
- [ ] Undo/redo history
- [ ] Layer editing tools
- [ ] Custom color palettes
- [ ] Batch processing

## Support

For issues, feature requests, or questions, please open an issue on GitHub.