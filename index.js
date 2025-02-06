const fs = require('fs');
const pdf = require('pdf-parse');
const sanitize = require('sanitize-filename');

class PDFToMarkdown {
  constructor(options = {}) {
    this.options = {
      preserveFormatting: true,
      preserveLinks: true,
      customPageRender: true,
      ...options
    };
    this.hyperlinks = new Map();
    this.pageTexts = new Map();
  }

  async convertFile(pdfPath, outputPath = null) {
    try {
      const dataBuffer = fs.readFileSync(pdfPath);
      const data = await pdf(dataBuffer, {
        pagerender: this.renderPage.bind(this),
        max: 0,
        firstPage: 1
      });

      const markdown = await this.processContent(data);

      if (outputPath) {
        fs.writeFileSync(sanitize(outputPath), markdown);
      }

      return markdown;
    } catch (error) {
      throw new Error(`Conversion failed: ${error.message}`);
    }
  }

  async renderPage(pageData) {
    try {
      const textContent = await pageData.getTextContent({
        normalizeWhitespace: true,
        disableCombineTextItems: false
      });
  
      const annotations = await pageData.getAnnotations();
      const processedContent = this.processPageContent(textContent, annotations);
      
      this.pageTexts.set(pageData.pageNumber, processedContent.text);
      this.hyperlinks.set(pageData.pageNumber, processedContent.links);
  
      return processedContent.text;
    } catch (error) {
      console.error(`Error rendering page ${pageData.pageNumber}:`, error);
      return '';
    }
  }

  processPageContent(textContent, annotations) {
    const lines = this.groupTextItemsByLine(textContent.items);
    const linkMap = this.createLinkMap(annotations);
    const links = [];
    let text = '';

    lines.forEach(line => {
      const processedLine = this.processLine(line, linkMap, links);
      text += processedLine + '\n';
    });

    return {
      text: this.normalizeSpacing(text.trim()),
      links: this.consolidateLinks(links)
    };
  }

  consolidateLinks(links) {
    const linkMap = new Map();
    links.forEach(link => {
      const existingLink = linkMap.get(link.url);
      if (!existingLink || link.text.length > existingLink.text.length) {
        linkMap.set(link.url, link);
      }
    });
    return Array.from(linkMap.values());
  }

  groupTextItemsByLine(items) {
    const lines = new Map();
    
    items.forEach(item => {
      const [, , , , x, y] = item.transform;
      const roundedY = Math.round(y);
      
      if (!lines.has(roundedY)) {
        lines.set(roundedY, []);
      }
      
      lines.get(roundedY).push({
        text: item.str,
        x: Math.round(x),
        y: roundedY,
        width: this.estimateCharWidth(item.str)
      });
    });

    return Array.from(lines.entries())
      .sort(([y1], [y2]) => y2 - y1)
      .map(([, items]) => items.sort((a, b) => a.x - b.x));
  }

  createLinkMap(annotations) {
    const linkMap = new Map();
    
    annotations.forEach(ann => {
      if (ann.subtype === 'Link' && ann.url) {
        const key = JSON.stringify(ann.rect.map(n => Math.round(n)));
        linkMap.set(key, ann.url);
      }
    });

    return linkMap;
  }

  processLine(lineItems, linkMap, links) {
    let lineText = '';
    let currentWordParts = [];
    let lastX = null;
    const spacingThreshold = 3;

    lineItems.forEach((item, index) => {
      const isLastItem = index === lineItems.length - 1;
      
      // Check for links
      for (const [rectKey, url] of linkMap.entries()) {
        const rect = JSON.parse(rectKey);
        if (this.isPointInRect(item.x, item.y, rect)) {
          this.addToLinks(links, item.text, url);
          break;
        }
      }

      // Handle spacing
      if (lastX !== null) {
        const gap = item.x - lastX;
        if (gap > spacingThreshold) {
          if (currentWordParts.length > 0) {
            lineText += currentWordParts.join('');
            currentWordParts = [];
          }
          lineText += ' ';
        }
      }

      currentWordParts.push(item.text);
      lastX = item.x + item.width;

      if (isLastItem && currentWordParts.length > 0) {
        lineText += currentWordParts.join('');
      }
    });

    return lineText.trim();
  }

  addToLinks(links, text, url) {
    const existingLink = links.find(l => l.url === url);
    if (existingLink) {
      existingLink.text = this.combineText(existingLink.text, text);
    } else {
      links.push({ text, url });
    }
  }

  combineText(existing, newText) {
    return existing.includes(newText) ? existing : `${existing}${newText}`;
  }

  estimateCharWidth(char) {
    return char.length * 8;
  }

  isPointInRect(x, y, rect) {
    const [x1, y1, x2, y2] = rect;
    const margin = 5;
    return x >= (x1 - margin) && x <= (x2 + margin) && y >= (y1 - margin) && y <= (y2 + margin);
  }

  normalizeSpacing(text) {
    return text
      .replace(/\s+/g, ' ')
      .replace(/\s*\|\s*/g, ' | ')
      .replace(/\s+,\s*/g, ', ')
      .replace(/\n\s*\n/g, '\n\n')
      .replace(/([^\n])\n([^\n])/g, '$1 $2')
      .trim();
  }

  async processContent(pdfData) {
    const pages = Array.from(this.pageTexts.values());
    
    let processedPages = pages.map((page, index) => {
      let processedText = this.processPage(page);
      const pageLinks = this.hyperlinks.get(index + 1) || [];
      return this.insertHyperlinks(processedText, pageLinks);
    });
  
    return this.formatMarkdown(processedPages.join('\n\n'));
  }

  processPage(pageText) {
    let text = this.normalizeSpacing(pageText);
    text = this.detectAndFormatSections(text);
    text = this.detectAndFormatLists(text);
    return text;
  }

  detectAndFormatSections(text) {
    const lines = text.split('\n');
    const formatted = lines.map(line => {
      const trimmed = line.trim();
      if (this.isSectionHeader(trimmed)) {
        return `\n## ${trimmed}\n`;
      }
      return line;
    });
    return formatted.join('\n');
  }

  isSectionHeader(text) {
    if (text.includes('@') || text.includes('http')) return false;
    if (text.length > 50) return false;
    
    return (
      text === text.toUpperCase() &&
      text.length >= 3 &&
      !/[^\w\s,-]/.test(text)
    );
  }

  detectAndFormatLists(text) {
    const lines = text.split('\n');
    let formatted = [];
    let inList = false;

    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('•') || trimmed.startsWith('-')) {
        inList = true;
        formatted.push(trimmed.replace(/^[•-]\s*/, '- '));
      } else if (inList && trimmed === '') {
        inList = false;
        formatted.push('');
      } else {
        formatted.push(line);
      }
    });

    return formatted.join('\n');
  }

  insertHyperlinks(text, links) {
    if (!links.length) return text;
    
    let result = text;
    links.forEach(link => {
      if (!link.text || !link.url) return;
      
      const escapedText = this.escapeRegExp(link.text.trim());
      const markdownLink = `[${link.text.trim()}](${link.url})`;
      
      const regex = new RegExp(`(?<!\\[)${escapedText}(?!\\]\\()`, 'g');
      result = result.replace(regex, markdownLink);
    });
    
    return result;
  }

  escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  formatMarkdown(text) {
    return text
      // Format header section
      .replace(/^(.*?)\n/, '$1\n\n')
      // Add spacing around section headers
      .replace(/\n##\s/g, '\n\n## ')
      // Ensure consistent list formatting
      .replace(/^-\s*/gm, '- ')
      // Clean up multiple blank lines
      .replace(/\n{3,}/g, '\n\n')
      // Ensure proper spacing around contact information
      .replace(/\|\s*/g, ' | ')
      // Clean up final output
      .trim();
  }
}

module.exports = PDFToMarkdown;