import * as fs from 'fs';
import pdf from 'pdf-parse';
import sanitize from 'sanitize-filename';

/**
 * Options that can be passed to PDFToMarkdown.
 */
interface PDFToMarkdownOptions {
  preserveFormatting?: boolean;
  preserveLinks?: boolean;
  customPageRender?: boolean;
}

/**
 * Fully resolved options used internally.
 */
interface ResolvedOptions {
  preserveFormatting: boolean;
  preserveLinks: boolean;
  customPageRender: boolean;
}

/**
 * Information about a hyperlink extracted from the PDF.
 */
interface LinkPosition {
  x: number;
  y: number;
  page: number;
}

export interface LinkInfo {
  text: string;
  url: string;
  position: LinkPosition;
}

/**
 * Information for annotations that represent links.
 */
interface LinkAnnotation {
  url: string;
  rect: number[];
}

/**
 * A text item coming from the PDF text content.
 */
interface TextItem {
  str: string;
  transform: number[];
  width?: number;
}

/**
 * The text content structure returned by the PDF library.
 */
interface TextContent {
  items: TextItem[];
}

/**
 * Processed text item after grouping, with position and estimated width.
 */
interface ProcessedTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
}

/**
 * An annotation as returned from the PDF page.
 */
interface PDFAnnotation {
  subtype: string;
  url?: string;
  rect: number[];
}

/**
 * Represents a page of the PDF with methods to extract text and annotations.
 */
interface PDFPageData {
  pageNumber: number;
  getTextContent(options: {
    normalizeWhitespace: boolean;
    disableCombineTextItems: boolean;
  }): Promise<TextContent>;
  getAnnotations(): Promise<PDFAnnotation[]>;
}

/**
 * The return type from the pdf-parse library.
 * (Not used extensively here, so kept as an alias for any.)
 */
type PDFData = any;

export default class PDFToMarkdown {
  private options: ResolvedOptions;
  private hyperlinks: Map<number, LinkInfo[]>;
  private pageTexts: Map<number, string>;

  constructor(options: PDFToMarkdownOptions = {}) {
    this.options = {
      preserveFormatting: true,
      preserveLinks: true,
      customPageRender: true,
      ...options,
    };
    this.hyperlinks = new Map<number, LinkInfo[]>();
    this.pageTexts = new Map<number, string>();
  }

  /**
   * Converts a PDF file from the given path to Markdown.
   *
   * @param pdfPath - The path to the PDF file.
   * @param outputPath - Optional path where the markdown file will be written.
   * @returns A promise resolving with the markdown string.
   */
  async convertFile(pdfPath: string, outputPath: string | null = null): Promise<string> {
    try {
      const dataBuffer = fs.readFileSync(pdfPath);
      return await this.convertBuffer(dataBuffer, outputPath);
    } catch (error: unknown) {
      throw new Error(`File conversion failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Converts a PDF from a Buffer to Markdown.
   *
   * @param buffer - The PDF data as a Buffer.
   * @param outputPath - Optional path to write the resulting markdown.
   * @returns A promise resolving with the markdown string.
   */
  async convertBuffer(buffer: Buffer, outputPath: string | null = null): Promise<string> {
  try {
    const data: PDFData = await pdf(buffer, {
      pagerender: this.renderPage.bind(this) as unknown as (pageData: any) => string,
      max: 0,
      firstPage: 1,
    } as any);
    const markdown = this.processContent(data);
    if (outputPath) {
      fs.writeFileSync(sanitize(outputPath), markdown);
    }
    return markdown;
  } catch (error: unknown) {
    throw new Error(`Buffer conversion failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}





  /**
   * Called for each page during PDF processing.
   *
   * @param pageData - The PDF page data.
   * @returns A promise resolving with the processed text of the page.
   */
  async renderPage(pageData: PDFPageData): Promise<string> {
    try {
      const textContent: TextContent = await pageData.getTextContent({
        normalizeWhitespace: true,
        disableCombineTextItems: false,
      });

      const annotations: PDFAnnotation[] = await pageData.getAnnotations();
      const processedContent = this.processPageContent(textContent, annotations, pageData.pageNumber);

      this.pageTexts.set(pageData.pageNumber, processedContent.text);
      this.hyperlinks.set(pageData.pageNumber, processedContent.links);

      return processedContent.text;
    } catch (error: unknown) {
      console.error(`Error rendering page ${pageData.pageNumber}:`, error);
      return '';
    }
  }

  /**
   * Processes the text content and annotations of a page.
   *
   * @param textContent - The raw text content.
   * @param annotations - The annotations from the page.
   * @param pageNumber - The page number.
   * @returns An object containing processed text and links.
   */
  processPageContent(
    textContent: TextContent,
    annotations: PDFAnnotation[],
    pageNumber: number
  ): { text: string; links: LinkInfo[] } {
    const lines = this.groupTextItemsByLine(textContent.items);
    const linkMap = this.createLinkMap(annotations);
    const links: LinkInfo[] = [];
    let text = '';

    lines.forEach((line) => {
      const processedLine = this.processLine(line, linkMap, links, pageNumber);
      text += processedLine + '\n';
    });

    return {
      text: this.normalizeSpacing(text.trim()),
      links,
    };
  }

  /**
   * Groups text items by their Y coordinate into lines.
   *
   * @param items - Array of text items.
   * @returns An array of lines, each being an array of processed text items.
   */
  groupTextItemsByLine(items: TextItem[]): ProcessedTextItem[][] {
    const lines = new Map<number, ProcessedTextItem[]>();

    items.forEach((item) => {
      // The transform array is assumed to have at least 6 numbers.
      const [, , , , x, y] = item.transform;
      const roundedY = Math.round(y * 100) / 100;

      if (!lines.has(roundedY)) {
        lines.set(roundedY, []);
      }

      lines.get(roundedY)!.push({
        text: item.str,
        x: Math.round(x * 100) / 100,
        y: roundedY,
        width: item.width !== undefined ? item.width : this.estimateCharWidth(item.str),
      });
    });

    return Array.from(lines.entries())
      .sort(([y1], [y2]) => y2 - y1)
      .map(([, items]) => items.sort((a, b) => a.x - b.x));
  }

  /**
   * Creates a map of link annotations keyed by their rounded rectangle coordinates.
   *
   * @param annotations - Array of PDF annotations.
   * @returns A Map where the key is a string representing the annotation rect.
   */
  createLinkMap(annotations: PDFAnnotation[]): Map<string, LinkAnnotation> {
    const linkMap = new Map<string, LinkAnnotation>();

    annotations.forEach((ann) => {
      if (ann.subtype === 'Link' && ann.url) {
        const key = ann.rect.map((n) => Math.round(n * 100) / 100).join(',');
        linkMap.set(key, {
          url: ann.url,
          rect: ann.rect,
        });
      }
    });

    return linkMap;
  }

  /**
   * Processes a single line of text items, inserting spaces if gaps are detected,
   * and checking for any links in the text.
   *
   * @param lineItems - The text items for this line.
   * @param linkMap - Map of link annotations.
   * @param links - An array to which found links will be added.
   * @param pageNumber - The page number.
   * @returns The processed line as a string.
   */
  processLine(
    lineItems: ProcessedTextItem[],
    linkMap: Map<string, LinkAnnotation>,
    links: LinkInfo[],
    pageNumber: number
  ): string {
    let lineText = '';
    let currentWordParts: string[] = [];
    let lastX: number | null = null;
    const spacingThreshold = 3;
    const currentLinks = new Set<LinkInfo>();

    lineItems.forEach((item, index) => {
      const isLastItem = index === lineItems.length - 1;

      // Check every link annotation to see if the current item is inside its rectangle.
      linkMap.forEach((linkInfo) => {
        if (this.isPointInRect(item.x, item.y, linkInfo.rect)) {
          currentLinks.add({
            text: item.text,
            url: linkInfo.url,
            position: {
              x: item.x,
              y: item.y,
              page: pageNumber,
            },
          });
        }
      });

      if (lastX !== null) {
        const gap = item.x - (lastX + this.estimateCharWidth(lineItems[index - 1].text));
        if (gap > spacingThreshold) {
          if (currentWordParts.length > 0) {
            lineText += currentWordParts.join('');
            currentWordParts = [];
          }
          lineText += ' ';
        }
      }

      currentWordParts.push(item.text);
      lastX = item.x;

      if (isLastItem && currentWordParts.length > 0) {
        lineText += currentWordParts.join('');
      }
    });

    currentLinks.forEach((link) => {
      this.addToLinks(links, link);
    });

    return lineText.trim();
  }

  /**
   * Adds a link to the links array, combining it with an existing link if appropriate.
   *
   * @param links - Array of currently collected links.
   * @param linkInfo - The link information to add.
   */
  addToLinks(links: LinkInfo[], linkInfo: LinkInfo): void {
    const existingLink = links.find(
      (l) =>
        l.url === linkInfo.url &&
        Math.abs(l.position.y - linkInfo.position.y) < 2 &&
        l.position.page === linkInfo.position.page
    );
  
    if (existingLink) {
      const xDiff = Math.abs(existingLink.position.x - linkInfo.position.x);
      // Increase the threshold factor to merge link parts even when the gap is a bit larger.
      if (xDiff < this.estimateCharWidth(existingLink.text) * 2) {
        existingLink.text = this.combineText(existingLink.text, linkInfo.text);
        existingLink.position.x = Math.min(existingLink.position.x, linkInfo.position.x);
      }
    } else {
      links.push({
        text: linkInfo.text,
        url: linkInfo.url,
        position: linkInfo.position,
      });
    }
  }

  /**
   * Combines two pieces of text intelligently.
   *
   * @param existing - The existing text.
   * @param newText - The new text to combine.
   * @returns The combined text.
   */
  combineText(existing: string, newText: string): string {
    if (existing.includes(newText)) return existing;
    if (newText.includes(existing)) return newText;

    const words = existing.split(/\s+/);
    const newWords = newText.split(/\s+/);

    if (words[words.length - 1] === newWords[0]) {
      return words.slice(0, -1).join(' ') + ' ' + newText;
    }

    return existing + ' ' + newText;
  }

  /**
   * Estimates the width of the given text.
   *
   * @param text - The text to measure.
   * @returns An estimated width in pixels.
   */
  estimateCharWidth(text: string): number {
    const averageCharWidth = 8;
    return text.length * averageCharWidth;
  }

  /**
   * Determines if a point is inside a given rectangle.
   *
   * @param x - The x-coordinate of the point.
   * @param y - The y-coordinate of the point.
   * @param rect - The rectangle [x1, y1, x2, y2].
   * @returns True if the point is inside the rectangle, false otherwise.
   */
  isPointInRect(x: number, y: number, rect: number[]): boolean {
    const [x1, y1, x2, y2] = rect;
    const margin = 2;
    return x >= x1 - margin &&
           x <= x2 + margin &&
           y >= y1 - margin &&
           y <= y2 + margin;
  }

  /**
   * Processes the content of the entire PDF after all pages have been rendered.
   *
   * @param pdfData - The PDF data (not directly used here).
   * @returns The final markdown string.
   */
  processContent(pdfData: PDFData): string {
    const pages = Array.from(this.pageTexts.values());

    const processedPages = pages.map((page, index) => {
      const processedText = this.processPage(page);
      const pageLinks = this.hyperlinks.get(index + 1) || [];
      return this.insertHyperlinks(processedText, pageLinks);
    });

    return this.formatMarkdown(processedPages.join('\n\n'));
  }

  /**
   * Processes a single page's text by normalizing spacing and formatting sections/lists.
   *
   * @param pageText - The raw text of the page.
   * @returns The processed text.
   */
  processPage(pageText: string): string {
    let text = this.normalizeSpacing(pageText);
    text = this.detectAndFormatSections(text);
    text = this.detectAndFormatLists(text);
    return text;
  }

  /**
   * Inserts markdown hyperlinks into the text where appropriate.
   *
   * @param text - The processed text.
   * @param links - An array of links to insert.
   * @returns The text with markdown links inserted.
   */
  insertHyperlinks(text: string, links: LinkInfo[]): string {
    // if (!links.length) return text;

    // links.sort((a, b) => {
    //   if (a.position.y !== b.position.y) return b.position.y - a.position.y;
    //   return a.position.x - b.position.x;
    // });
  
    // let result = text;
    // const processedPositions = new Set<string>();
  
    // links.forEach((link) => {
    //   const trimmedLinkText = link.text.trim();
    //   if (!trimmedLinkText || !link.url) return;
  
    //   const positionKey = `${link.position.x},${link.position.y}`;
    //   if (processedPositions.has(positionKey)) return;
  
    //   const escapedText = this.escapeRegExp(trimmedLinkText);
    //   const markdownLink = `[${trimmedLinkText}](${link.url})`;
    //   // Use word boundaries.
    //   const regex = new RegExp(`\\b${escapedText}\\b`, 'g');
    //   result = result.replace(regex, markdownLink);
  
    //   processedPositions.add(positionKey);
    // });
  
    // return result;
  }


  /**
   * Escapes special characters in a string to use in a regular expression.
   *
   * @param string - The string to escape.
   * @returns The escaped string.
   */
  escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Normalizes whitespace in the text.
   *
   * @param text - The text to process.
   * @returns The normalized text.
   */
  normalizeSpacing(text: string): string {
    return text.replace(/\s{2,}/g, ' ').trim();
  }

  /**
   * Detects section headers and formats them as markdown headers.
   *
   * @param text - The text to process.
   * @returns The text with formatted section headers.
   */
  detectAndFormatSections(text: string): string {
    const lines = text.split('\n');
    const formatted: string[] = [];
    let lastLineWasHeader = false;

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (this.isSectionHeader(trimmed)) {
        if (index !== 0 && !lastLineWasHeader) {
          formatted.push('');
        }
        formatted.push(`\n## ${trimmed}\n`);
        lastLineWasHeader = true;
      } else {
        formatted.push(line);
        lastLineWasHeader = false;
      }
    });
    return formatted.join('\n');
  }

  /**
   * Determines whether a given line of text should be considered a section header.
   *
   * @param text - The text to check.
   * @returns True if the text is a section header, false otherwise.
   */
  isSectionHeader(text: string): boolean {
    if (text.includes('@') || text.includes('http')) return false;
    if (text.length > 70) return false;

    return (
      text === text.toUpperCase() ||
      (text.length >= 2 && !/[^\w\s,-]/.test(text))
    );
  }

  /**
   * Detects list items in the text and formats them as markdown lists.
   *
   * @param text - The text to process.
   * @returns The text with formatted list items.
   */
  detectAndFormatLists(text: string): string {
    const lines = text.split('\n');
    const formatted: string[] = [];
    let inList = false;

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      const isListItem = trimmed.startsWith('•') || trimmed.startsWith('-') || /^\d+\./.test(trimmed);

      if (isListItem) {
        inList = true;
        // Replace the bullet/digit with a dash.
        formatted.push(trimmed.replace(/^[•-\d.]\s*/, '- '));
      } else if (
        inList &&
        (trimmed === '' || (!isListItem && index > 0 && lines[index - 1].trim() !== ''))
      ) {
        inList = false;
        formatted.push('');
      } else {
        formatted.push(line);
      }
    });

    return formatted.join('\n');
  }

  /**
   * Applies final markdown formatting to the text.
   *
   * @param text - The text to format.
   * @returns The formatted markdown text.
   */
  formatMarkdown(text: string): string {
    return text
      .replace(/^(.*?)\n/, '$1\n\n')
      .replace(/\n##\s/g, '\n\n## ')
      .replace(/^-\s*/gm, '- ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
