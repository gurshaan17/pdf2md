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
      return await this.convertBuffer(dataBuffer, outputPath);
    } catch (error) {
      throw new Error(`File conversion failed: ${error.message}`);
    }
  }

  async convertBuffer(buffer, outputPath = null) {
    try {
      const data = await pdf(buffer, {
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
      throw new Error(`Buffer conversion failed: ${error.message}`);
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
      const roundedY = Math.round(y * 100) / 100;

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
    if (existing.includes(newText)) return existing;
    if (newText.includes(existing)) return newText;

    const words = existing.split(/\s+/);
    const newWords = newText.split(/\s+/);

    if (words[words.length - 1] === newWords[0]) {
      return words.slice(0, -1).join(' ') + ' ' + newText;
    }

    return existing + ' ' + newText;
  }

  estimateCharWidth(text) {
    const averageCharWidth = 8;
    return text.length * averageCharWidth;
  }

  isPointInRect(x, y, rect) {
    const [x1, y1, x2, y2] = rect;
    const margin = 2;
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

  processPage(pageText) {
    let text = this.normalizeSpacing(pageText);
    text = this.detectAndFormatSections(text);
    text = this.detectAndFormatLists(text);
    return text;
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

        const positionKey = `${link.position.x},${link.position.y},${link.position.page}`; 
        if (processedPositions.has(positionKey)) return;

        const linkWords = link.text.trim().split(/\s+/);
        const textWords = text.split(/\s+/);
        let startIndex = -1;

        for (let i = 0; i <= textWords.length - linkWords.length; i++) {
          let match = true;
          for (let j = 0; j < linkWords.length; j++) {
            if (textWords[i + j].trim() !== linkWords[j].trim()) {
              match = false;
              break;
            }
          }
          if (match) {
            startIndex = i;
            break;
          }
        }

        if (startIndex !== -1) {
          const endIndex = startIndex + linkWords.length;
          const markdownLink = `[${linkWords.join(' ')}](${link.url})`;
          textWords.splice(startIndex, linkWords.length, markdownLink);
          result = textWords.join(' ');
          processedPositions.add(positionKey);
        } else {
          // Fallback: If exact match fails, try replacing any occurrence of the link text.
          const escapedText = this.escapeRegExp(link.text.trim());
          const regex = new RegExp(escapedText, 'g');
          const markdownLink = `[${link.text.trim()}](${link.url})`;
          result = result.replace(regex, markdownLink);
          processedPositions.add(positionKey);
        }
    });

    return result;
}


  escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  normalizeSpacing(text) {
    return text.replace(/\s{2,}/g, ' ').trim();
  }

  detectAndFormatSections(text) {
    const lines = text.split('\n');
    const formatted = [];
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

  isSectionHeader(text) {
    if (text.includes('@') || text.includes('http')) return false;
    if (text.length > 70) return false;

    return (
      text === text.toUpperCase() ||
      (text.length >= 2 && !/[^\w\s,-]/.test(text))
    );
  }

  detectAndFormatLists(text) {
    const lines = text.split('\n');
    let formatted = [];
    let inList = false;

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      const isListItem = trimmed.startsWith('•') || trimmed.startsWith('-') || /^\d+\./.test(trimmed);

      if (isListItem) {
        inList = true;
        formatted.push(trimmed.replace(/^[•-\d.]\s*/, '- '));
      } else if (inList && (trimmed === '' || !isListItem && index > 0 && lines[index - 1].trim() !== '')) {
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
      .trim();
  }

  processContent(pdfData) {
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
}

module.exports = PDFToMarkdown;