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
      
      // Create a more flexible link position mapping
      const linkMap = this.createLinkMap(annotations, textContent);
      const processedContent = this.processPageContent(textContent, linkMap);
      
      this.pageTexts.set(pageData.pageNumber, processedContent.text);
      this.hyperlinks.set(pageData.pageNumber, processedContent.links);
  
      return processedContent.text;
    } catch (error) {
      console.error(`Error rendering page ${pageData.pageNumber}:`, error);
      return '';
    }
  }

  createLinkMap(annotations, textContent) {
    const linkMap = new Map();
    
    annotations.forEach(ann => {
      if (ann.subtype === 'Link' && ann.url) {
        // Find text items that fall within this annotation's rectangle
        const linkedText = textContent.items.filter(item => {
          const [, , , , x, y] = item.transform;
          return this.isPointInRect(x, y, ann.rect);
        });

        linkedText.forEach(item => {
          linkMap.set(item.str, ann.url);
        });
      }
    });

    return linkMap;
  }

  isPointInRect(x, y, rect) {
    const [x1, y1, x2, y2] = rect;
    const margin = 3; // Add a small margin for better text matching
    return x >= (x1 - margin) && x <= (x2 + margin) && y >= (y1 - margin) && y <= (y2 + margin);
  }

  processPageContent(textContent, linkMap) {
    let text = '';
    const links = [];
    let lastY;
    let currentLine = '';
    
    for (const item of textContent.items) {
      const [, , , , x, y] = item.transform;
      
      // Check for new line
      if (lastY !== undefined && Math.abs(lastY - y) > 5) {
        text += currentLine + '\n';
        currentLine = '';
      }
      
      // Check if this text is part of a link
      if (linkMap.has(item.str)) {
        links.push({
          text: item.str,
          url: linkMap.get(item.str)
        });
      }
      
      currentLine += item.str + (item.hasEOL ? '' : ' ');
      lastY = y;
    }
    
    // Add the last line
    if (currentLine) {
      text += currentLine;
    }
    
    return {
      text: text.trim(),
      links: this.consolidateLinks(links)
    };
  }

  consolidateLinks(links) {
    const linkMap = new Map();
    
    links.forEach(link => {
      if (linkMap.has(link.url)) {
        const existing = linkMap.get(link.url);
        if (existing.text !== link.text) {
          // Keep the longer text if different versions exist
          if (link.text.length > existing.text.length) {
            linkMap.set(link.url, link);
          }
        }
      } else {
        linkMap.set(link.url, link);
      }
    });
    
    return Array.from(linkMap.values());
  }

  async processContent(pdfData) {
    const pages = Array.from(this.pageTexts.values());
    
    let processedPages = pages.map((page, index) => {
      let processedText = this.processPage(page);
      const pageLinks = this.hyperlinks.get(index + 1) || [];
      return this.insertHyperlinks(processedText, pageLinks);
    });
  
    return processedPages.join('\n');
  }

  insertHyperlinks(text, links) {
    if (!links.length) return text;
    
    let result = text;
    const processedLinks = new Map();
    
    // Sort links by text length (descending) to handle longer matches first
    links.sort((a, b) => b.text.length - a.text.length);
    
    for (const link of links) {
      if (!link.text || !link.url || processedLinks.has(link.url)) continue;
      
      const escapedText = this.escapeRegExp(link.text.trim());
      const markdownLink = `[${link.text.trim()}](${link.url})`;
      
      // Only replace exact matches that aren't already part of a markdown link
      const regex = new RegExp(`(?<!\\[)${escapedText}(?!\\]\\()`, 'g');
      result = result.replace(regex, markdownLink);
      
      processedLinks.set(link.url, true);
    }
    
    return result;
  }

  escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  processPage(pageText) {
    let text = pageText
      .replace(/\r\n/g, '\n')
      .replace(/([^\n])\n([^\n])/g, '$1 $2')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    text = this.detectAndFormatHeaders(text);
    text = this.detectAndFormatLists(text);
    
    return text;
  }

  detectAndFormatHeaders(text) {
    const lines = text.split('\n');
    const formatted = lines.map((line) => {
      const trimmedLine = line.trim();
      
      if (!trimmedLine) return '';
      
      if (this.isHeader(trimmedLine)) {
        return `# ${trimmedLine}`;
      }
      
      return trimmedLine;
    });

    return formatted.join('\n');
  }

  isHeader(text) {
    if (text.includes('@') || text.includes('http')) return false;
    if (text.length > 50) return false;
    
    // Improved header detection
    return (
      /^[A-Z][^a-z]{0,3}[A-Z\s\d]{3,}$/.test(text) ||
      (text === text.toUpperCase() && /^[A-Z][\w\s-]{2,49}$/.test(text))
    );
  }

  detectAndFormatLists(text) {
    const lines = text.split('\n');
    let inList = false;
    
    const formatted = lines.map((line) => {
      const trimmedLine = line.trim();
      
      const bulletMatch = trimmedLine.match(/^[-•*]\s+(.+)/);
      const numberMatch = trimmedLine.match(/^(\d+[.)])\s+(.+)/);
      
      if (bulletMatch) {
        inList = true;
        return `- ${bulletMatch[1]}`;
      } else if (numberMatch) {
        inList = true;
        return `${numberMatch[1]} ${numberMatch[2]}`;
      } else if (inList && /^\s+/.test(line)) {
        return line;
      } else {
        inList = false;
        return line;
      }
    });

    return formatted.join('\n');
  }
}

module.exports = PDFToMarkdown;