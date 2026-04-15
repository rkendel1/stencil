/**
 * Manual test for AI integration modules
 * Run this in the browser console to test the modules
 */

// Test composite assembler
async function testCompositeAssembler() {
  const { assembleShadedComposite, getLayerShades, imageDataToBase64 } = 
    await import('../src/compositeAssembler.js');
  
  console.log('Testing Composite Assembler...');
  
  // Create test masks
  const width = 100;
  const height = 100;
  const numLayers = 4;
  
  const masks = Array.from({ length: numLayers }, (_, i) => {
    const mask = new Uint8Array(width * height);
    // Create a gradient pattern for each layer
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        // Layer fills different regions
        if (y >= i * 25 && y < (i + 1) * 25) {
          mask[idx] = 1;
        }
      }
    }
    return mask;
  });
  
  // Test shade generation
  const shades = getLayerShades(numLayers);
  console.log('Shades:', shades);
  console.assert(shades.length === numLayers, 'Shade count mismatch');
  
  // Verify shades are evenly spaced and in correct range
  const expectedFirst = 1 / (numLayers + 1);
  const expectedLast = numLayers / (numLayers + 1);
  console.assert(Math.abs(shades[0] - expectedFirst) < 0.001, `First shade incorrect: ${shades[0]} vs ${expectedFirst}`);
  console.assert(Math.abs(shades[numLayers - 1] - expectedLast) < 0.001, `Last shade incorrect: ${shades[numLayers - 1]} vs ${expectedLast}`);
  
  // Test composite assembly
  const composite = assembleShadedComposite(masks, width, height);
  console.log('Composite:', composite);
  console.assert(composite.width === width, 'Width mismatch');
  console.assert(composite.height === height, 'Height mismatch');
  console.assert(composite.data.length === width * height * 4, 'Data length mismatch');
  
  // Test base64 conversion
  const base64 = await imageDataToBase64(composite);
  console.log('Base64 length:', base64.length);
  console.assert(base64.startsWith('data:image/png;base64,'), 'Invalid base64 format');
  
  console.log('✅ Composite Assembler tests passed!');
  return { composite, base64, shades };
}

// Test AI evaluation module
async function testAIEvaluation() {
  const { evaluateComposite } = await import('../src/aiEvaluation.js');
  
  console.log('Testing AI Evaluation...');
  
  // Test without API key (should skip gracefully)
  const result = await evaluateComposite(null, null, [], []);
  console.log('Result without API key:', result);
  console.assert(result.skipped === true, 'Should skip when no API key');
  console.assert(result.layer_balance.needs_adjustment === false, 'Should have default values');
  
  console.log('✅ AI Evaluation tests passed!');
  return result;
}

// Run all tests
async function runTests() {
  try {
    console.log('=== Starting Tests ===');
    await testCompositeAssembler();
    await testAIEvaluation();
    console.log('=== All Tests Passed! ===');
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Export for use in console
window.runStencilTests = runTests;

console.log('Manual tests loaded. Run: runStencilTests()');
