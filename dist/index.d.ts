/// <reference types="node" />
/// <reference types="node" />
/**
 * Options that can be passed to PDFToMarkdown.
 */
interface PDFToMarkdownOptions {
    preserveFormatting?: boolean;
    preserveLinks?: boolean;
    customPageRender?: boolean;
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
    private options;
    private hyperlinks;
    private pageTexts;
    constructor(options?: PDFToMarkdownOptions);
    /**
     * Converts a PDF file from the given path to Markdown.
     *
     * @param pdfPath - The path to the PDF file.
     * @param outputPath - Optional path where the markdown file will be written.
     * @returns A promise resolving with the markdown string.
     */
    convertFile(pdfPath: string, outputPath?: string | null): Promise<string>;
    /**
     * Converts a PDF from a Buffer to Markdown.
     *
     * @param buffer - The PDF data as a Buffer.
     * @param outputPath - Optional path to write the resulting markdown.
     * @returns A promise resolving with the markdown string.
     */
    convertBuffer(buffer: Buffer, outputPath?: string | null): Promise<string>;
    /**
     * Called for each page during PDF processing.
     *
     * @param pageData - The PDF page data.
     * @returns A promise resolving with the processed text of the page.
     */
    renderPage(pageData: PDFPageData): Promise<string>;
    /**
     * Processes the text content and annotations of a page.
     *
     * @param textContent - The raw text content.
     * @param annotations - The annotations from the page.
     * @param pageNumber - The page number.
     * @returns An object containing processed text and links.
     */
    processPageContent(textContent: TextContent, annotations: PDFAnnotation[], pageNumber: number): {
        text: string;
        links: LinkInfo[];
    };
    /**
     * Groups text items by their Y coordinate into lines.
     *
     * @param items - Array of text items.
     * @returns An array of lines, each being an array of processed text items.
     */
    groupTextItemsByLine(items: TextItem[]): ProcessedTextItem[][];
    /**
     * Creates a map of link annotations keyed by their rounded rectangle coordinates.
     *
     * @param annotations - Array of PDF annotations.
     * @returns A Map where the key is a string representing the annotation rect.
     */
    createLinkMap(annotations: PDFAnnotation[]): Map<string, LinkAnnotation>;
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
    processLine(lineItems: ProcessedTextItem[], linkMap: Map<string, LinkAnnotation>, links: LinkInfo[], pageNumber: number): string;
    /**
     * Adds a link to the links array, combining it with an existing link if appropriate.
     *
     * @param links - Array of currently collected links.
     * @param linkInfo - The link information to add.
     */
    addToLinks(links: LinkInfo[], linkInfo: LinkInfo): void;
    /**
     * Combines two pieces of text intelligently.
     *
     * @param existing - The existing text.
     * @param newText - The new text to combine.
     * @returns The combined text.
     */
    combineText(existing: string, newText: string): string;
    /**
     * Estimates the width of the given text.
     *
     * @param text - The text to measure.
     * @returns An estimated width in pixels.
     */
    estimateCharWidth(text: string): number;
    /**
     * Determines if a point is inside a given rectangle.
     *
     * @param x - The x-coordinate of the point.
     * @param y - The y-coordinate of the point.
     * @param rect - The rectangle [x1, y1, x2, y2].
     * @returns True if the point is inside the rectangle, false otherwise.
     */
    isPointInRect(x: number, y: number, rect: number[]): boolean;
    /**
     * Processes the content of the entire PDF after all pages have been rendered.
     *
     * @param pdfData - The PDF data (not directly used here).
     * @returns The final markdown string.
     */
    processContent(pdfData: PDFData): string;
    /**
     * Processes a single page's text by normalizing spacing and formatting sections/lists.
     *
     * @param pageText - The raw text of the page.
     * @returns The processed text.
     */
    processPage(pageText: string): string;
    /**
     * Inserts markdown hyperlinks into the text where appropriate.
     *
     * @param text - The processed text.
     * @param links - An array of links to insert.
     * @returns The text with markdown links inserted.
     */
    insertHyperlinks(text: string, links: LinkInfo[]): string;
    /**
     * Escapes special characters in a string to use in a regular expression.
     *
     * @param string - The string to escape.
     * @returns The escaped string.
     */
    escapeRegExp(string: string): string;
    /**
     * Normalizes whitespace in the text.
     *
     * @param text - The text to process.
     * @returns The normalized text.
     */
    normalizeSpacing(text: string): string;
    /**
     * Detects section headers and formats them as markdown headers.
     *
     * @param text - The text to process.
     * @returns The text with formatted section headers.
     */
    detectAndFormatSections(text: string): string;
    /**
     * Determines whether a given line of text should be considered a section header.
     *
     * @param text - The text to check.
     * @returns True if the text is a section header, false otherwise.
     */
    isSectionHeader(text: string): boolean;
    /**
     * Detects list items in the text and formats them as markdown lists.
     *
     * @param text - The text to process.
     * @returns The text with formatted list items.
     */
    detectAndFormatLists(text: string): string;
    /**
     * Applies final markdown formatting to the text.
     *
     * @param text - The text to format.
     * @returns The formatted markdown text.
     */
    formatMarkdown(text: string): string;
}
export {};
