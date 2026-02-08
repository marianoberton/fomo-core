/**
 * Calculator tool — safe mathematical expression evaluation.
 *
 * Uses a recursive-descent parser (NO eval) to evaluate math expressions.
 * Supports arithmetic, exponents, parentheses, unary minus, and built-in
 * functions (sqrt, abs, ceil, floor, round, min, max, sin, cos, tan, log, log2, log10).
 */
import { z } from 'zod';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'calculator' });

const MAX_EXPRESSION_LENGTH = 1000;

const inputSchema = z.object({
  expression: z.string().min(1).max(MAX_EXPRESSION_LENGTH),
});

const outputSchema = z.object({
  result: z.number(),
  expression: z.string(),
});

// ─── Tokenizer ─────────────────────────────────────────────────

type TokenType = 'number' | 'operator' | 'lparen' | 'rparen' | 'comma' | 'identifier';

interface Token {
  type: TokenType;
  value: string;
}

const CONSTANTS: Record<string, number> = {
  PI: Math.PI,
  E: Math.E,
};

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sqrt: (x) => Math.sqrt(x),
  abs: (x) => Math.abs(x),
  ceil: (x) => Math.ceil(x),
  floor: (x) => Math.floor(x),
  round: (x) => Math.round(x),
  min: (...args) => Math.min(...args),
  max: (...args) => Math.max(...args),
  sin: (x) => Math.sin(x),
  cos: (x) => Math.cos(x),
  tan: (x) => Math.tan(x),
  log: (x) => Math.log(x),
  log2: (x) => Math.log2(x),
  log10: (x) => Math.log10(x),
};

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = expression.length;

  while (i < len) {
    const ch = expression.charAt(i);

    // Skip whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Numbers (integers and decimals)
    if (/[0-9.]/.test(ch)) {
      let num = '';
      let hasDot = false;
      while (i < len && /[0-9.]/.test(expression.charAt(i))) {
        if (expression.charAt(i) === '.') {
          if (hasDot) break;
          hasDot = true;
        }
        num += expression.charAt(i);
        i++;
      }
      tokens.push({ type: 'number', value: num });
      continue;
    }

    // Identifiers (function names or constants)
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = '';
      while (i < len && /[a-zA-Z0-9_]/.test(expression.charAt(i))) {
        ident += expression.charAt(i);
        i++;
      }
      tokens.push({ type: 'identifier', value: ident });
      continue;
    }

    // Two-character operators
    if (ch === '*' && expression[i + 1] === '*') {
      tokens.push({ type: 'operator', value: '**' });
      i += 2;
      continue;
    }

    // Single-character operators
    if ('+-*/%'.includes(ch)) {
      tokens.push({ type: 'operator', value: ch });
      i++;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'lparen', value: '(' });
      i++;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'rparen', value: ')' });
      i++;
      continue;
    }

    if (ch === ',') {
      tokens.push({ type: 'comma', value: ',' });
      i++;
      continue;
    }

    throw new Error(`Unexpected character '${ch}' at position ${String(i)}`);
  }

  return tokens;
}

// ─── Recursive Descent Parser ──────────────────────────────────

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): number {
    const result = this.parseExpression();
    if (this.pos < this.tokens.length) {
      const unexpected = this.tokens[this.pos];
      throw new Error(`Unexpected token '${unexpected ? unexpected.value : '???'}' at position ${String(this.pos)}`);
    }
    return result;
  }

  // expression = term (('+' | '-') term)*
  private parseExpression(): number {
    let left = this.parseTerm();

    while (this.pos < this.tokens.length) {
      const token = this.tokens[this.pos];
      if (token?.type !== 'operator' || (token.value !== '+' && token.value !== '-')) break;
      this.pos++;
      const right = this.parseTerm();
      left = token.value === '+' ? left + right : left - right;
    }

    return left;
  }

  // term = exponent (('*' | '/' | '%') exponent)*
  private parseTerm(): number {
    let left = this.parseExponent();

    while (this.pos < this.tokens.length) {
      const token = this.tokens[this.pos];
      if (token?.type !== 'operator' || (token.value !== '*' && token.value !== '/' && token.value !== '%')) break;
      this.pos++;
      const right = this.parseExponent();
      if (token.value === '*') {
        left = left * right;
      } else if (token.value === '/') {
        if (right === 0) throw new Error('Division by zero');
        left = left / right;
      } else {
        if (right === 0) throw new Error('Division by zero');
        left = left % right;
      }
    }

    return left;
  }

  // exponent = unary ('**' exponent)?   (right-associative)
  private parseExponent(): number {
    const base = this.parseUnary();

    const token = this.tokens[this.pos];
    if (token?.type === 'operator' && token.value === '**') {
      this.pos++;
      const exp = this.parseExponent(); // right-associative recursion
      return Math.pow(base, exp);
    }

    return base;
  }

  // unary = ('+' | '-') unary | primary
  private parseUnary(): number {
    const token = this.tokens[this.pos];
    if (token?.type === 'operator' && (token.value === '+' || token.value === '-')) {
      this.pos++;
      const operand = this.parseUnary();
      return token.value === '-' ? -operand : operand;
    }
    return this.parsePrimary();
  }

  // primary = number | constant | function '(' args ')' | '(' expression ')'
  private parsePrimary(): number {
    const token = this.tokens[this.pos];

    if (!token) {
      throw new Error('Unexpected end of expression');
    }

    // Number literal
    if (token.type === 'number') {
      this.pos++;
      const num = Number(token.value);
      if (!Number.isFinite(num)) throw new Error(`Invalid number: ${token.value}`);
      return num;
    }

    // Identifier (constant or function)
    if (token.type === 'identifier') {
      this.pos++;

      // Check for constant
      if (token.value in CONSTANTS) {
        const constVal = CONSTANTS[token.value];
        if (constVal !== undefined) return constVal;
      }

      // Check for function call
      if (token.value in FUNCTIONS) {
        const next = this.tokens[this.pos];
        if (next?.type !== 'lparen') {
          throw new Error(`Expected '(' after function '${token.value}'`);
        }
        this.pos++; // skip '('

        const args: number[] = [];
        if (this.tokens[this.pos]?.type !== 'rparen') {
          args.push(this.parseExpression());
          while (this.tokens[this.pos]?.type === 'comma') {
            this.pos++; // skip ','
            args.push(this.parseExpression());
          }
        }

        const rparen = this.tokens[this.pos];
        if (rparen?.type !== 'rparen') {
          throw new Error(`Expected ')' after arguments of '${token.value}'`);
        }
        this.pos++; // skip ')'

        const fn = FUNCTIONS[token.value] as (...args: number[]) => number;
        return fn(...args);
      }

      throw new Error(`Unknown identifier '${token.value}'`);
    }

    // Parenthesized expression
    if (token.type === 'lparen') {
      this.pos++; // skip '('
      const result = this.parseExpression();
      const rparen = this.tokens[this.pos];
      if (rparen?.type !== 'rparen') {
        throw new Error("Expected ')'");
      }
      this.pos++; // skip ')'
      return result;
    }

    throw new Error(`Unexpected token '${token.value}'`);
  }
}

function evaluate(expression: string): number {
  const tokens = tokenize(expression);
  if (tokens.length === 0) throw new Error('Empty expression');
  const parser = new Parser(tokens);
  const result = parser.parse();
  if (!Number.isFinite(result)) throw new Error('Result is not finite');
  return result;
}

// ─── Tool Factory ──────────────────────────────────────────────

/** Create a calculator tool that safely evaluates math expressions. */
export function createCalculatorTool(): ExecutableTool {
  return {
    id: 'calculator',
    name: 'Calculator',
    description:
      'Evaluates mathematical expressions safely. Supports arithmetic (+, -, *, /, %, **), ' +
      'parentheses, and functions (sqrt, abs, ceil, floor, round, min, max, sin, cos, tan, log, log2, log10). ' +
      'Constants: PI, E.',
    category: 'utility',
    inputSchema,
    outputSchema,
    riskLevel: 'low',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    execute(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      const startTime = Date.now();
      const parsed = inputSchema.parse(input);

      try {
        const result = evaluate(parsed.expression);

        logger.debug('Calculator evaluated expression', {
          component: 'calculator',
          projectId: context.projectId,
          traceId: context.traceId,
          expression: parsed.expression,
          result,
        });

        return Promise.resolve(ok({
          success: true,
          output: { result, expression: parsed.expression },
          durationMs: Date.now() - startTime,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Promise.resolve(err(new ToolExecutionError('calculator', message)));
      }
    },

    dryRun(
      input: unknown,
      context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void context;
      const parsed = inputSchema.parse(input);

      try {
        // Validate the expression parses (tokenize + check structure)
        const tokens = tokenize(parsed.expression);
        if (tokens.length === 0) throw new Error('Empty expression');

        return Promise.resolve(ok({
          success: true,
          output: {
            expression: parsed.expression,
            valid: true,
            tokenCount: tokens.length,
            dryRun: true,
          },
          durationMs: 0,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Promise.resolve(err(new ToolExecutionError('calculator', message)));
      }
    },
  };
}
