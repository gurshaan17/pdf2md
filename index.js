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
      const processedContent = this.processPageContent(textContent, annotations, pageData.pageNumber);
      
      this.pageTexts.set(pageData.pageNumber, processedContent.text);
      this.hyperlinks.set(pageData.pageNumber, processedContent.links);
  
      return processedContent.text;
    } catch (error) {
      console.error(`Error rendering page ${pageData.pageNumber}:`, error);
      return '';
    }
  }

  processPageContent(textContent, annotations, pageNumber) {
    const lines = this.groupTextItemsByLine(textContent.items);
    const linkMap = this.createLinkMap(annotations);
    const links = [];
    let text = '';

    lines.forEach(line => {
      const processedLine = this.processLine(line, linkMap, links, pageNumber);
      text += processedLine + '\n';
    });

    return {
      text: this.normalizeSpacing(text.trim()),
      links
    };
  }

  groupTextItemsByLine(items) {
    const lines = new Map();
    
    items.forEach(item => {
      const [, , , , x, y] = item.transform;
      const roundedY = Math.round(y * 100) / 100; // More precise rounding
      
      if (!lines.has(roundedY)) {
        lines.set(roundedY, []);
      }
      
      lines.get(roundedY).push({
        text: item.str,
        x: Math.round(x * 100) / 100,
        y: roundedY,
        width: item.width || this.estimateCharWidth(item.str)
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
        // Create a more precise key using all coordinates
        const key = ann.rect.map(n => Math.round(n * 100) / 100).join(',');
        linkMap.set(key, {
          url: ann.url,
          rect: ann.rect
        });
      }
    });

    return linkMap;
  }

  processLine(lineItems, linkMap, links, pageNumber) {
    let lineText = '';
    let currentWordParts = [];
    let lastX = null;
    const spacingThreshold = 3;
    let currentLinks = new Set();

    lineItems.forEach((item, index) => {
      const isLastItem = index === lineItems.length - 1;
      
      // Check for links with improved precision
      for (const [, linkInfo] of linkMap) {
        if (this.isPointInRect(item.x, item.y, linkInfo.rect)) {
          currentLinks.add({
            text: item.text,
            url: linkInfo.url,
            position: {
              x: item.x,
              y: item.y,
              page: pageNumber
            }
          });
        }
      }

      // Handle spacing
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

    // Process collected links
    currentLinks.forEach(link => {
      this.addToLinks(links, link);
    });

    return lineText.trim();
  }

  addToLinks(links, linkInfo) {
    const existingLink = links.find(l => 
      l.url === linkInfo.url && 
      Math.abs(l.position.y - linkInfo.position.y) < 2 &&
      l.position.page === linkInfo.position.page
    );

    if (existingLink) {
      // Only combine if they're actually adjacent
      const xDiff = Math.abs(existingLink.position.x - linkInfo.position.x);
      if (xDiff < this.estimateCharWidth(existingLink.text)) {
        existingLink.text = this.combineText(existingLink.text, linkInfo.text);
        existingLink.position.x = Math.min(existingLink.position.x, linkInfo.position.x);
      }
    } else {
      links.push({
        text: linkInfo.text,
        url: linkInfo.url,
        position: linkInfo.position
      });
    }
  }

  combineText(existing, newText) {
    // Improved text combination logic
    if (existing.includes(newText)) return existing;
    if (newText.includes(existing)) return newText;
    
    // Check for partial overlaps
    const words = existing.split(/\s+/);
    const newWords = newText.split(/\s+/);
    
    if (words[words.length - 1] === newWords[0]) {
      return words.slice(0, -1).join(' ') + ' ' + newText;
    }
    
    return existing + ' ' + newText;
  }

  estimateCharWidth(text) {
    // More accurate character width estimation
    const averageCharWidth = 8;
    return text.length * averageCharWidth;
  }

  isPointInRect(x, y, rect) {
    const [x1, y1, x2, y2] = rect;
    const margin = 2; // Reduced margin for more precise detection
    return x >= (x1 - margin) && x <= (x2 + margin) && 
           y >= (y1 - margin) && y <= (y2 + margin);
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

  insertHyperlinks(text, links) {
    if (!links.length) return text;
    
    // Sort links by position to handle overlapping links correctly
    links.sort((a, b) => {
      if (a.position.y !== b.position.y) return b.position.y - a.position.y;
      return a.position.x - b.position.x;
    });
    
    let result = text;
    const processedPositions = new Set();
    
    links.forEach(link => {
      if (!link.text || !link.url) return;
      
      const positionKey = `${link.position.x},${link.position.y}`;
      if (processedPositions.has(positionKey)) return;
      
      const escapedText = this.escapeRegExp(link.text.trim());
      const markdownLink = `[${link.text.trim()}](${link.url})`;
      
      const regex = new RegExp(`(?<!\\[)${escapedText}(?!\\]\\()`, 'g');
      result = result.replace(regex, markdownLink);
      
      processedPositions.add(positionKey);
    });
    
    return result;
  }

  // Rest of the methods remain the same...
  escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  formatMarkdown(text) {
    return text
      .replace(/^(.*?)\n/, '$1\n\n')
      .replace(/\n##\s/g, '\n\n## ')
      .replace(/^-\s*/gm, '- ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\|\s*/g, ' | ')
      .trim();
  }
}

module.exports = PDFToMarkdown;