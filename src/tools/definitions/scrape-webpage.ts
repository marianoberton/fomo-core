/**
 * Scrape Webpage Tool — loads a URL in a headless browser and extracts content.
 * Uses Puppeteer for full JS rendering. Handles SPAs, dynamic pages, screenshots.
 * Includes SSRF protection. Designed for the manager agent.
 */
import { z } from 'zod';
import puppeteer from 'puppeteer';
import type { ExecutionContext } from '@/core/types.js';
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
import { ToolExecutionError } from '@/core/errors.js';
import type { NexusError } from '@/core/errors.js';
import type { ExecutableTool, ToolResult } from '@/tools/types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'scrape-webpage' });

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_CONTENT_LENGTH = 15_000; // chars of extracted text to return

// ─── Schemas ────────────────────────────────────────────────────

const inputSchema = z.object({
  url: z.string().url()
    .describe('The URL of the webpage to scrape.'),
  selector: z.string().optional()
    .describe('Optional CSS selector to extract a specific section (e.g. ".product-list", "#prices"). If omitted, extracts the full page content.'),
  waitForSelector: z.string().optional()
    .describe('Optional CSS selector to wait for before extracting content. Useful for SPAs that load data dynamically.'),
  extractLinks: z.boolean().default(false)
    .describe('Whether to include links found on the page. Default: false.'),
  screenshot: z.boolean().default(false)
    .describe('Whether to take a screenshot of the page. Returns base64 encoded PNG. Default: false.'),
});

const outputSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  metaDescription: z.string().optional(),
  content: z.string(),
  contentLength: z.number(),
  truncated: z.boolean(),
  links: z.array(z.object({
    text: z.string(),
    href: z.string(),
  })).optional(),
  screenshotBase64: z.string().optional(),
});

// ─── SSRF Protection ────────────────────────────────────────────

const BLOCKED_IPV4_PREFIXES = [
  '10.', '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.',
  '172.24.', '172.25.', '172.26.', '172.27.',
  '172.28.', '172.29.', '172.30.', '172.31.',
  '192.168.', '127.', '169.254.', '0.',
];

const BLOCKED_HOSTNAMES = ['localhost', '0.0.0.0', '[::1]', '[::0]'];

/** Block requests to private/loopback addresses. */
function validateUrl(urlStr: string): URL {
  const parsed = new URL(urlStr);

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }

  const lower = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.includes(lower)) {
    throw new Error('Blocked host: requests to private/reserved IPs are not allowed');
  }
  for (const prefix of BLOCKED_IPV4_PREFIXES) {
    if (lower.startsWith(prefix)) {
      throw new Error('Blocked host: requests to private/reserved IPs are not allowed');
    }
  }
  if (lower.startsWith('[fc') || lower.startsWith('[fd') ||
      lower.startsWith('[fe8') || lower.startsWith('[fe9')) {
    throw new Error('Blocked host: requests to private/reserved IPs are not allowed');
  }

  return parsed;
}

// ─── Factory ────────────────────────────────────────────────────

/** Create a scrape-webpage tool powered by Puppeteer (headless Chrome). */
export function createScrapeWebpageTool(): ExecutableTool {
  return {
    id: 'scrape-webpage',
    name: 'Scrape Webpage',
    description:
      'Load a URL in a headless browser and extract its content. Renders JavaScript (works with SPAs). ' +
      'Returns page title, meta description, cleaned text, and optionally links or a screenshot. ' +
      'Use a CSS selector to target specific sections. Can wait for dynamic content to load.',
    category: 'integration',
    inputSchema,
    outputSchema,
    riskLevel: 'medium',
    requiresApproval: false,
    sideEffects: false,
    supportsDryRun: true,

    async execute(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void _context;
      const startTime = Date.now();
      const data = inputSchema.parse(input) as {
        url: string;
        selector?: string;
        waitForSelector?: string;
        extractLinks: boolean;
        screenshot: boolean;
      };

      let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

      try {
        // Validate URL (SSRF protection)
        const parsedUrl = validateUrl(data.url);

        logger.info('Scraping webpage with Puppeteer', {
          component: 'scrape-webpage',
          url: parsedUrl.origin + parsedUrl.pathname,
        });

        // Launch browser
        browser = await puppeteer.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
          ],
        });

        const page = await browser.newPage();

        // Set viewport and user agent
        await page.setViewport({ width: 1280, height: 900 });
        await page.setUserAgent(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        );

        // Navigate to URL
        await page.goto(data.url, {
          waitUntil: 'networkidle2',
          timeout: DEFAULT_TIMEOUT_MS,
        });

        // Wait for specific selector if requested
        if (data.waitForSelector) {
          await page.waitForSelector(data.waitForSelector, { timeout: 10_000 }).catch(() => {
            logger.info('waitForSelector timed out, continuing with available content', {
              component: 'scrape-webpage',
              selector: data.waitForSelector,
            });
          });
        }

        // Extract content using page.evaluate (runs in browser context)
        const extracted = await page.evaluate((opts: { selector?: string; extractLinks: boolean; maxLen: number }) => {
          // Remove noise
          const noise = document.querySelectorAll('script, style, noscript, iframe, svg');
          noise.forEach((el) => el.remove());

          const title = document.title || undefined;
          const metaEl = document.querySelector('meta[name="description"]');
          const metaDescription = metaEl?.getAttribute('content')?.trim() || undefined;

          // Find content root
          let root: Element | null = null;
          if (opts.selector) {
            root = document.querySelector(opts.selector);
          }
          if (!root) {
            root = document.querySelector('main, article, [role="main"]');
          }
          if (!root) {
            root = document.body;
          }

          // Extract text
          const rawText = (root as HTMLElement).innerText || root.textContent || '';
          const content = rawText
            .replace(/[\t ]+/g, ' ')
            .replace(/\n\s*\n+/g, '\n\n')
            .trim();

          const truncated = content.length > opts.maxLen;
          const finalContent = truncated ? content.slice(0, opts.maxLen) + '...' : content;

          // Extract links if requested
          let links: Array<{ text: string; href: string }> | undefined;
          if (opts.extractLinks) {
            const linkEls = (opts.selector ? root : document.body).querySelectorAll('a[href]');
            const seen = new Set<string>();
            links = [];
            linkEls.forEach((a) => {
              const href = (a as HTMLAnchorElement).href;
              const text = (a as HTMLAnchorElement).innerText?.trim();
              if (!href || !text || !href.startsWith('http') || seen.has(href)) return;
              seen.add(href);
              links!.push({ text: text.slice(0, 100), href });
            });
            links = links.slice(0, 50);
          }

          return { title, metaDescription, content: finalContent, contentLength: finalContent.length, truncated, links };
        }, { selector: data.selector, extractLinks: data.extractLinks, maxLen: MAX_CONTENT_LENGTH });

        // Screenshot if requested
        let screenshotBase64: string | undefined;
        if (data.screenshot) {
          const buffer = await page.screenshot({ type: 'png', fullPage: false });
          screenshotBase64 = Buffer.from(buffer).toString('base64');
        }

        await browser.close();
        browser = null;

        const output = {
          url: data.url,
          title: extracted.title,
          metaDescription: extracted.metaDescription,
          content: extracted.content,
          contentLength: extracted.contentLength,
          truncated: extracted.truncated,
          links: extracted.links,
          screenshotBase64,
        };

        return await Promise.resolve(ok({
          success: true,
          output,
          durationMs: Date.now() - startTime,
        }));
      } catch (error) {
        return err(new ToolExecutionError(
          'scrape-webpage',
          error instanceof Error ? error.message : 'Unknown error scraping webpage',
        ));
      } finally {
        if (browser) {
          await browser.close().catch(() => { /* ignore */ });
        }
      }
    },

    async dryRun(
      input: unknown,
      _context: ExecutionContext,
    ): Promise<Result<ToolResult, NexusError>> {
      void _context;
      const startTime = Date.now();
      const data = inputSchema.parse(input) as {
        url: string;
        selector?: string;
        waitForSelector?: string;
        extractLinks: boolean;
        screenshot: boolean;
      };

      try {
        validateUrl(data.url);
      } catch (error) {
        return err(new ToolExecutionError(
          'scrape-webpage',
          error instanceof Error ? error.message : 'Invalid URL',
        ));
      }

      return await Promise.resolve(ok({
        success: true,
        output: {
          dryRun: true,
          description: `Would open ${data.url} in headless Chrome`,
          selector: data.selector ?? '(full page)',
          waitForSelector: data.waitForSelector,
          extractLinks: data.extractLinks,
          screenshot: data.screenshot,
        },
        durationMs: Date.now() - startTime,
      }));
    },
  };
}
