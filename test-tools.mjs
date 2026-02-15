import { createToolRegistry } from './dist/tools/registry/tool-registry.js';
import { createCalculatorTool, createDateTimeTool, createJsonTransformTool } from './dist/tools/definitions/index.js';

const registry = createToolRegistry();
registry.register(createCalculatorTool());
registry.register(createDateTimeTool());
registry.register(createJsonTransformTool());

// Create a minimal execution context
const mockContext = {
  projectId: 'test',
  sessionId: 'test',
  traceId: 'test',
  agentConfig: { allowedTools: ['calculator', 'date-time', 'json-transform'] },
  permissions: { allowedTools: new Set(['calculator', 'date-time', 'json-transform']) },
  abortSignal: AbortSignal.timeout(5000),
};

async function testTool(toolId, input) {
  console.log(`\n=== Testing ${toolId} ===`);
  console.log('Input:', JSON.stringify(input));
  
  try {
    const tool = registry.get(toolId);
    if (!tool) {
      console.error('❌ Tool not found');
      return false;
    }

    const result = await tool.execute(input, mockContext);
    if (!result.ok) {
      console.error('❌ Execution failed:', result.error.message);
      return false;
    }

    console.log('✅ Result:', JSON.stringify(result.value));
    return true;
  } catch (error) {
    console.error('❌ Exception:', error.message);
    return false;
  }
}

async function main() {
  console.log('🧪 Testing Nexus Core Built-in Tools\n');
  
  const tests = [
    // Calculator tests
    { toolId: 'calculator', input: { expression: '15 * 23' } },
    { toolId: 'calculator', input: { expression: 'sqrt(144) + 10' } },
    { toolId: 'calculator', input: { expression: '2 ^ 8' } },
    
    // DateTime tests
    { toolId: 'date-time', input: { operation: 'now' } },
    { toolId: 'date-time', input: { operation: 'format', timestamp: new Date().toISOString(), format: 'YYYY-MM-DD' } },
    
    // JSON Transform tests
    { toolId: 'json-transform', input: { 
      operation: 'get', 
      data: { user: { name: 'Test', age: 25 } },
      path: 'user.name'
    }},
    { toolId: 'json-transform', input: { 
      operation: 'set', 
      data: { count: 5 },
      path: 'count',
      value: 10
    }},
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const success = await testTool(test.toolId, test.input);
    if (success) passed++;
    else failed++;
  }

  console.log(`\n\n📊 Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
