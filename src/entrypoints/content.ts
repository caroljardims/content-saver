import { Readability } from '@mozilla/readability';
import { browser } from 'wxt/browser';
import type { Extraction } from '../lib/messages';

/**
 * Registered at runtime rather than declared in the manifest, so the
 * extension asks for no host permissions at install time. The background
 * injects it into the active tab only when the user actually saves something.
 */
export default defineContentScript({
  matches: ['*://*/*'],
  registration: 'runtime',

  main() {
    browser.runtime.onMessage.addListener((message: unknown) => {
      if ((message as { type?: string })?.type !== 'extract') return undefined;
      return Promise.resolve(extract());
    });
  },
});

function meta(...names: string[]): string {
  for (const name of names) {
    const el = document.querySelector<HTMLMetaElement>(
      `meta[property="${name}"], meta[name="${name}"]`,
    );
    if (el?.content) return el.content;
  }
  return '';
}

function extract(): Extraction {
  const selection = window.getSelection()?.toString().trim() ?? '';

  // Readability mutates the document it parses, so hand it a clone.
  let article: ReturnType<Readability['parse']> = null;
  try {
    article = new Readability(document.cloneNode(true) as Document).parse();
  } catch {
    // Not every page is an article. Metadata below still works.
  }

  return {
    url: location.href,
    title: article?.title || document.title || location.href,
    siteName: article?.siteName || meta('og:site_name') || location.hostname,
    excerpt: article?.excerpt || meta('og:description', 'description'),
    content: article?.textContent?.trim() ?? '',
    selection,
  };
}
