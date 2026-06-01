import { readFile } from 'node:fs/promises';

const NOTION_VERSION = '2022-06-28';
const MAX_RICH_TEXT_LENGTH = 1900;
const MAX_CHILDREN_PER_REQUEST = 100;

const markdownPath = process.env.PRIVACY_POLICY_PATH || 'privacy-policy.md';
const notionToken = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
const notionPageId = process.env.NOTION_PAGE_ID || process.env.NOTION_TARGET_PAGE_ID;
const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

function assertEnv() {
  if (dryRun) return;
  if (!notionToken) throw new Error('NOTION_API_KEY is required');
  if (!notionPageId) throw new Error('NOTION_PAGE_ID is required');
}

function plainText(text) {
  return [{ type: 'text', text: { content: text } }];
}

function splitText(text, limit = MAX_RICH_TEXT_LENGTH) {
  const chunks = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf(' ', limit);
    if (cut < limit * 0.5) cut = limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function richText(markdown) {
  const result = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;

  function push(content, annotations = {}, href) {
    if (!content) return;
    for (const chunk of splitText(content)) {
      result.push({
        type: 'text',
        text: { content: chunk, ...(href ? { link: { url: href } } : {}) },
        annotations
      });
    }
  }

  for (const match of markdown.matchAll(pattern)) {
    push(markdown.slice(lastIndex, match.index));
    const token = match[0];

    if (token.startsWith('`')) {
      push(token.slice(1, -1), { code: true });
    } else if (token.startsWith('**')) {
      push(token.slice(2, -2), { bold: true });
    } else if (token.startsWith('*')) {
      push(token.slice(1, -1), { italic: true });
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) push(link[1], {}, link[2]);
      else push(token);
    }
    lastIndex = match.index + token.length;
  }

  push(markdown.slice(lastIndex));
  return result.length ? result : plainText('');
}

function paragraph(text) {
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: richText(text) } };
}

function heading(level, text) {
  const type = level === 1 ? 'heading_1' : level === 2 ? 'heading_2' : 'heading_3';
  return { object: 'block', type, [type]: { rich_text: richText(text) } };
}

function bulleted(text) {
  return { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: richText(text) } };
}

function numbered(text) {
  return { object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: richText(text) } };
}

function todo(checked, text) {
  return { object: 'block', type: 'to_do', to_do: { rich_text: richText(text), checked } };
}

function quote(text) {
  return { object: 'block', type: 'quote', quote: { rich_text: richText(text) } };
}

function codeBlock(language, text) {
  return {
    object: 'block',
    type: 'code',
    code: {
      rich_text: plainText(text.slice(0, 1900)),
      language: normalizeCodeLanguage(language)
    }
  };
}

function imageBlock(url, caption = '') {
  return {
    object: 'block',
    type: 'image',
    image: {
      type: 'external',
      external: { url },
      caption: caption ? richText(caption) : []
    }
  };
}

function normalizeCodeLanguage(language) {
  const lang = String(language || 'plain text').toLowerCase();
  if (['js', 'javascript', 'mjs'].includes(lang)) return 'javascript';
  if (['ts', 'typescript'].includes(lang)) return 'typescript';
  if (['md', 'markdown'].includes(lang)) return 'markdown';
  if (['yml', 'yaml'].includes(lang)) return 'yaml';
  if (['sh', 'shell', 'bash'].includes(lang)) return 'shell';
  if (['text', 'txt', 'plain'].includes(lang)) return 'plain text';
  return lang;
}

function flushParagraph(blocks, paragraphLines) {
  if (!paragraphLines.length) return;
  const text = paragraphLines.join(' ').trim();
  if (text) blocks.push(...splitText(text).map(paragraph));
  paragraphLines.length = 0;
}

function markdownToBlocks(markdown) {
  const blocks = [];
  const paragraphLines = [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    const fence = trimmed.match(/^```([A-Za-z0-9_-]*)\s*$/);
    if (fence) {
      flushParagraph(blocks, paragraphLines);
      const language = fence[1] || 'plain text';
      const codeLines = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      blocks.push(codeBlock(language, codeLines.join('\n')));
      continue;
    }

    if (!trimmed) {
      flushParagraph(blocks, paragraphLines);
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph(blocks, paragraphLines);
      blocks.push(heading(headingMatch[1].length, headingMatch[2]));
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      flushParagraph(blocks, paragraphLines);
      blocks.push({ object: 'block', type: 'divider', divider: {} });
      continue;
    }

    const imageMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imageMatch) {
      flushParagraph(blocks, paragraphLines);
      blocks.push(imageBlock(imageMatch[2], imageMatch[1]));
      continue;
    }

    const todoMatch = trimmed.match(/^- \[([ xX])\]\s+(.+)$/);
    if (todoMatch) {
      flushParagraph(blocks, paragraphLines);
      blocks.push(todo(todoMatch[1].toLowerCase() === 'x', todoMatch[2]));
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph(blocks, paragraphLines);
      blocks.push(bulleted(bulletMatch[1]));
      continue;
    }

    const numberMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (numberMatch) {
      flushParagraph(blocks, paragraphLines);
      blocks.push(numbered(numberMatch[1]));
      continue;
    }

    const quoteMatch = trimmed.match(/^>\s?(.+)$/);
    if (quoteMatch) {
      flushParagraph(blocks, paragraphLines);
      blocks.push(quote(quoteMatch[1]));
      continue;
    }

    paragraphLines.push(trimmed);
  }

  flushParagraph(blocks, paragraphLines);
  return blocks;
}

async function notionRequest(path, options = {}) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${notionToken}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const message = body?.message || text || res.statusText;
    throw new Error(`Notion API ${res.status}: ${message}`);
  }
  return body;
}

async function withRetry(operation) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable = /Notion API (429|5\d\d)/.test(error.message);
      if (!retryable || attempt === 4) break;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function listChildBlocks(blockId) {
  const blocks = [];
  let startCursor;
  do {
    const query = new URLSearchParams({ page_size: '100' });
    if (startCursor) query.set('start_cursor', startCursor);
    const body = await withRetry(() => notionRequest(`/blocks/${blockId}/children?${query}`));
    blocks.push(...body.results);
    startCursor = body.has_more ? body.next_cursor : undefined;
  } while (startCursor);
  return blocks;
}

async function clearPage(blockId) {
  const children = await listChildBlocks(blockId);
  for (const child of children) {
    await withRetry(() => notionRequest(`/blocks/${child.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true })
    }));
  }
}

async function appendBlocks(blockId, blocks) {
  for (let index = 0; index < blocks.length; index += MAX_CHILDREN_PER_REQUEST) {
    const children = blocks.slice(index, index + MAX_CHILDREN_PER_REQUEST);
    await withRetry(() => notionRequest(`/blocks/${blockId}/children`, {
      method: 'PATCH',
      body: JSON.stringify({ children })
    }));
  }
}

const markdown = await readFile(markdownPath, 'utf8');
const blocks = markdownToBlocks(markdown);

if (dryRun) {
  console.log(JSON.stringify({
    markdownPath,
    blockCount: blocks.length,
    firstBlocks: blocks.slice(0, 5)
  }, null, 2));
} else {
  assertEnv();
  await clearPage(notionPageId);
  await appendBlocks(notionPageId, blocks);
  console.log(`Synced ${blocks.length} blocks from ${markdownPath} to Notion page ${notionPageId}`);
}
