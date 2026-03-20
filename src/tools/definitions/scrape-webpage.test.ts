import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createScrapeWebpageTool } from './scrape-webpage.js';
import { createTestContext } from '@/testing/fixtures/context.js';

// ─── Puppeteer Mock ─────────────────────────────────────────────

const mockScreenshot = vi.fn();
const mockWaitForSelector = vi.fn();
const mockEvaluate = vi.fn();
const mockGoto = vi.fn();
const mockSetViewport = vi.fn();
const mockSetUserAgent = vi.fn();
const mockNewPage = vi.fn();
const mockClose = vi.fn();
const mockLaunch = vi.fn();

vi.mock('puppeteer', () => ({
  default: {
    launch: (...args: unknown[]) => mockLaunch(...args),
  },
}));

function setupMockBrowser(evaluateResult: Record<string, unknown>) {
  const mockPage = {
    setViewport: mockSetViewport.mockResolvedValue(undefined),
    setUserAgent: mockSetUserAgent.mockResolvedValue(undefined),
    goto: mockGoto.mockResolvedValue(undefined),
    waitForSelector: mockWaitForSelector,
    evaluate: mockEvaluate,
    screenshot: mockScreenshot,
  };

  mockEvaluate.mockResolvedValue(evaluateResult);
  mockNewPage.mockResolvedValue(mockPage);
  mockClose.mockResolvedValue(undefined);
  mockLaunch.mockResolvedValue({
    newPage: mockNewPage,
    close: mockClose,
  });
}

function makeContext() {
  return createTestContext({ projectId: 'proj-1' });
}

// ─── Tests ──────────────────────────────────────────────────────

describe('scrape-webpage', () => {
  beforeEach(() => {
    mockLaunch.mockClear();
    mockNewPage.mockClear();
    mockClose.mockClear();
    mockGoto.mockClear();
    mockSetViewport.mockClear();
    mockSetUserAgent.mockClear();
    mockEvaluate.mockClear();
    mockWaitForSelector.mockClear();
    mockScreenshot.mockClear();
  });

  // ─── Schema Tests ───────────────────────────────────────────

  describe('schema', () => {
    it('has correct metadata', () => {
      const tool = createScrapeWebpageTool();
      expect(tool.id).toBe('scrape-webpage');
      expect(tool.category).toBe('integration');
      expect(tool.riskLevel).toBe('medium');
      expect(tool.requiresApproval).toBe(false);
      expect(tool.sideEffects).toBe(false);
      expect(tool.supportsDryRun).toBe(true);
    });

    it('rejects invalid URL', async () => {
      const tool = createScrapeWebpageTool();
      await expect(tool.execute({ url: 'not-a-url' }, makeContext())).rejects.toThrow();
    });
  });

  // ─── Dry Run Tests ──────────────────────────────────────────

  describe('dryRun', () => {
    it('validates URL without launching browser', async () => {
      const tool = createScrapeWebpageTool();
      const result = await tool.dryRun(
        { url: 'https://example.com/prices' },
        makeContext(),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const output = result.value.output as { dryRun: boolean; description: string };
      expect(output.dryRun).toBe(true);
      expect(output.description).toContain('example.com');
      expect(mockLaunch).not.toHaveBeenCalled();
    });

    it('rejects private IPs in dryRun', async () => {
      const tool = createScrapeWebpageTool();
      const result = await tool.dryRun(
        { url: 'http://192.168.1.1/admin' },
        makeContext(),
      );

      expect(result.ok).toBe(false);
    });

    it('includes all options in dryRun output', async () => {
      const tool = createScrapeWebpageTool();
      const result = await tool.dryRun(
        {
          url: 'https://example.com',
          selector: '.prices',
          waitForSelector: '#loaded',
          extractLinks: true,
          screenshot: true,
        },
        makeContext(),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const output = result.value.output as {
        selector: string;
        waitForSelector: string;
        extractLinks: boolean;
        screenshot: boolean;
      };
      expect(output.selector).toBe('.prices');
      expect(output.waitForSelector).toBe('#loaded');
      expect(output.extractLinks).toBe(true);
      expect(output.screenshot).toBe(true);
    });
  });

  // ─── Execute Tests ──────────────────────────────────────────

  describe('execute', () => {
    it('extracts title, meta, and content from page', async () => {
      setupMockBrowser({
        title: 'Ferretería El Martillo — Precios',
        metaDescription: 'Los mejores precios en herramientas',
        content: 'Catálogo de Precios\n\nTaladro Bosch GSB 13\n$45.990\n\nAmoladora DeWalt DWE4120\n$38.500',
        contentLength: 80,
        truncated: false,
        links: undefined,
      });

      const tool = createScrapeWebpageTool();
      const result = await tool.execute(
        { url: 'https://ferreteria.com/precios' },
        makeContext(),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const output = result.value.output as {
        url: string;
        title: string;
        metaDescription: string;
        content: string;
        truncated: boolean;
        links?: unknown[];
        screenshotBase64?: string;
      };

      expect(output.url).toBe('https://ferreteria.com/precios');
      expect(output.title).toBe('Ferretería El Martillo — Precios');
      expect(output.metaDescription).toBe('Los mejores precios en herramientas');
      expect(output.content).toContain('Taladro Bosch GSB 13');
      expect(output.content).toContain('$45.990');
      expect(output.content).toContain('Amoladora DeWalt');
      expect(output.truncated).toBe(false);
      expect(output.links).toBeUndefined();
      expect(output.screenshotBase64).toBeUndefined();
    });

    it('launches headless browser with correct args', async () => {
      setupMockBrowser({
        title: 'Test',
        content: 'Hello',
        contentLength: 5,
        truncated: false,
      });

      const tool = createScrapeWebpageTool();
      await tool.execute(
        { url: 'https://example.com' },
        makeContext(),
      );

      expect(mockLaunch).toHaveBeenCalledWith(
        expect.objectContaining({
          headless: true,
          args: expect.arrayContaining([
            '--no-sandbox',
            '--disable-setuid-sandbox',
          ]) as string[],
        }),
      );
    });

    it('navigates with networkidle2 and timeout', async () => {
      setupMockBrowser({
        title: 'Test',
        content: 'Hello',
        contentLength: 5,
        truncated: false,
      });

      const tool = createScrapeWebpageTool();
      await tool.execute(
        { url: 'https://example.com/page' },
        makeContext(),
      );

      expect(mockGoto).toHaveBeenCalledWith('https://example.com/page', {
        waitUntil: 'networkidle2',
        timeout: 30_000,
      });
    });

    it('passes selector to page.evaluate', async () => {
      setupMockBrowser({
        title: 'Test',
        content: 'Product data only',
        contentLength: 17,
        truncated: false,
      });

      const tool = createScrapeWebpageTool();
      await tool.execute(
        { url: 'https://ferreteria.com/precios', selector: '.product-list' },
        makeContext(),
      );

      // page.evaluate receives (fn, opts)
      expect(mockEvaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ selector: '.product-list' }),
      );
    });

    it('extracts links when requested', async () => {
      const mockLinks = [
        { text: 'Contacto', href: 'https://ferreteria.com/contacto' },
        { text: 'Otro sitio', href: 'https://example.com/otro' },
      ];
      setupMockBrowser({
        title: 'Test',
        content: 'Page content',
        contentLength: 12,
        truncated: false,
        links: mockLinks,
      });

      const tool = createScrapeWebpageTool();
      const result = await tool.execute(
        { url: 'https://ferreteria.com/precios', extractLinks: true },
        makeContext(),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const output = result.value.output as {
        links: { text: string; href: string }[];
      };

      expect(output.links).toBeDefined();
      expect(output.links).toHaveLength(2);
      expect(output.links.some((l) => l.text === 'Contacto')).toBe(true);
      expect(output.links.some((l) => l.href === 'https://example.com/otro')).toBe(true);
    });

    it('waits for selector when waitForSelector is provided', async () => {
      setupMockBrowser({
        title: 'SPA',
        content: 'Dynamic content loaded',
        contentLength: 22,
        truncated: false,
      });
      mockWaitForSelector.mockResolvedValue(null);

      const tool = createScrapeWebpageTool();
      await tool.execute(
        { url: 'https://spa-app.com', waitForSelector: '#data-loaded' },
        makeContext(),
      );

      expect(mockWaitForSelector).toHaveBeenCalledWith('#data-loaded', { timeout: 10_000 });
    });

    it('continues gracefully when waitForSelector times out', async () => {
      setupMockBrowser({
        title: 'SPA',
        content: 'Partial content',
        contentLength: 15,
        truncated: false,
      });
      mockWaitForSelector.mockRejectedValue(new Error('Timeout'));

      const tool = createScrapeWebpageTool();
      const result = await tool.execute(
        { url: 'https://spa-app.com', waitForSelector: '#never-appears' },
        makeContext(),
      );

      // Should still succeed — waitForSelector timeout is caught
      expect(result.ok).toBe(true);
    });

    it('takes screenshot when requested', async () => {
      setupMockBrowser({
        title: 'Test',
        content: 'Hello',
        contentLength: 5,
        truncated: false,
      });
      const fakeBuffer = Buffer.from('fake-png-data');
      mockScreenshot.mockResolvedValue(fakeBuffer);

      const tool = createScrapeWebpageTool();
      const result = await tool.execute(
        { url: 'https://example.com', screenshot: true },
        makeContext(),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(mockScreenshot).toHaveBeenCalledWith({ type: 'png', fullPage: false });

      const output = result.value.output as { screenshotBase64: string };
      expect(output.screenshotBase64).toBe(fakeBuffer.toString('base64'));
    });

    it('does not take screenshot by default', async () => {
      setupMockBrowser({
        title: 'Test',
        content: 'Hello',
        contentLength: 5,
        truncated: false,
      });

      const tool = createScrapeWebpageTool();
      await tool.execute(
        { url: 'https://example.com' },
        makeContext(),
      );

      expect(mockScreenshot).not.toHaveBeenCalled();
    });

    it('blocks SSRF attempts', async () => {
      const tool = createScrapeWebpageTool();

      const result = await tool.execute(
        { url: 'http://127.0.0.1/secret' },
        makeContext(),
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('Blocked host');
      expect(mockLaunch).not.toHaveBeenCalled();
    });

    it('blocks localhost SSRF', async () => {
      const tool = createScrapeWebpageTool();

      const result = await tool.execute(
        { url: 'http://localhost:3000/admin' },
        makeContext(),
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('Blocked host');
    });

    it('blocks private 192.168.x IPs', async () => {
      const tool = createScrapeWebpageTool();

      const result = await tool.execute(
        { url: 'http://192.168.0.1/config' },
        makeContext(),
      );

      expect(result.ok).toBe(false);
    });

    it('handles browser launch errors gracefully', async () => {
      mockLaunch.mockRejectedValue(new Error('Failed to launch Chrome'));

      const tool = createScrapeWebpageTool();
      const result = await tool.execute(
        { url: 'https://example.com' },
        makeContext(),
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('Failed to launch Chrome');
    });

    it('handles navigation errors gracefully', async () => {
      setupMockBrowser({ title: '', content: '', contentLength: 0, truncated: false });
      mockGoto.mockRejectedValue(new Error('net::ERR_NAME_NOT_RESOLVED'));

      const tool = createScrapeWebpageTool();
      const result = await tool.execute(
        { url: 'https://nonexistent.invalid' },
        makeContext(),
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain('ERR_NAME_NOT_RESOLVED');
    });

    it('closes browser after successful execution', async () => {
      setupMockBrowser({
        title: 'Test',
        content: 'Hello',
        contentLength: 5,
        truncated: false,
      });

      const tool = createScrapeWebpageTool();
      await tool.execute(
        { url: 'https://example.com' },
        makeContext(),
      );

      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('closes browser after error', async () => {
      setupMockBrowser({ title: '', content: '', contentLength: 0, truncated: false });
      mockGoto.mockRejectedValue(new Error('Timeout'));

      const tool = createScrapeWebpageTool();
      await tool.execute(
        { url: 'https://slow-site.com' },
        makeContext(),
      );

      // browser.close() called in finally block
      expect(mockClose).toHaveBeenCalled();
    });

    it('handles truncated content', async () => {
      setupMockBrowser({
        title: 'Big Page',
        content: 'x'.repeat(15_000) + '...',
        contentLength: 15_003,
        truncated: true,
      });

      const tool = createScrapeWebpageTool();
      const result = await tool.execute(
        { url: 'https://example.com/big' },
        makeContext(),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const output = result.value.output as { truncated: boolean; contentLength: number };
      expect(output.truncated).toBe(true);
      expect(output.contentLength).toBeGreaterThan(15_000);
    });
  });
});
