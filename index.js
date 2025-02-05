const fs = require('fs');
const pdfjsLib = require('pdfjs-dist');
const sanitize = require('sanitize-filename');

class PDFToMarkdown {
  constructor(options = {}) {
    this.options = {
      preserveFormatting: true,
      preserveLinks: true,
      ...options
    };
    this.hyperlinks = new Map();
  }

  async convertFile(pdfPath, outputPath = null) {
    try {
      const data = new Uint8Array(fs.readFileSync(pdfPath));
      const loadingTask = pdfjsLib.getDocument(data);
      const pdfDocument = await loadingTask.promise;
      
      let fullText = '';
      
      // Process each page
      for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
        const page = await pdfDocument.getPage(pageNum);
        const [textContent, annotations] = await Promise.all([
          page.getTextContent(),
          page.getAnnotations()
        ]);
        
        // Extract links from annotations
        const links = annotations
          .filter(annotation => annotation.subtype === 'Link' && annotation.url)
          .map(annotation => ({
            url: annotation.url,
            rect: annotation.rect,
            pageNum
          }));
        
        // Store links for this page
        this.hyperlinks.set(pageNum, links);
        
        // Process text content
        const pageText = await this.processPageContent(textContent, links);
        fullText += pageText + '\n\n';
      }
      
      const markdown = this.processText(fullText.trim());
      
      if (outputPath) {
        fs.writeFileSync(sanitize(outputPath), markdown);
      }
      
      return markdown;
    } catch (error) {
      throw new Error(`Conversion failed: ${error.message}`);
    }
  }

  async processPageContent(textContent, links) {
    let text = '';
    let lastY;
    const textItems = [];
    
    // Collect text items with their positions
    textContent.items.forEach(item => {
      const [x, y] = item.transform.slice(4);
      textItems.push({
        text: item.str,
        x,
        y,
        width: item.width,
        height: item.height
      });
    });
    
    // Match links to text
    links.forEach(link => {
      const [x1, y1, x2, y2] = link.rect;
      const matchingItems = textItems.filter(item => 
        item.x >= x1 && item.x <= x2 &&
        item.y >= y1 && item.y <= y2
      );
      
      if (matchingItems.length > 0) {
        const linkText = matchingItems.map(item => item.text).join(' ');
        this.hyperlinks.get(link.pageNum).push({
          text: linkText,
          url: link.url
        });
      }
    });
    
    // Construct page text with proper formatting
    textItems.forEach(item => {
      if (lastY !== undefined && Math.abs(lastY - item.y) > item.height) {
        text += '\n';
      }
      text += item.text;
      lastY = item.y;
    });
    
    return text;
  }

  processText(text) {
    let markdown = text;
    
    // Process hyperlinks
    this.hyperlinks.forEach(links => {
      links.forEach(link => {
        if (link.text && link.url) {
          const markdownLink = `[${link.text}](${link.url})`;
          const regex = new RegExp(this.escapeRegExp(link.text), 'g');
          markdown = markdown.replace(regex, markdownLink);
        }
      });
    });
    
    // Apply other formatting
    markdown = this.detectAndFormatHeaders(markdown);
    markdown = this.detectAndFormatLists(markdown);
    markdown = this.formatParagraphs(markdown);
    
    return markdown;
  }

  escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  detectAndFormatHeaders(text) {
    const lines = text.split('\n');
    return lines.map(line => {
      if (line.match(/^[A-Z][^.!?]*$/) && line.length < 100) {
        return `# ${line.trim()}`;
      }
      return line;
    }).join('\n');
  }

  detectAndFormatLists(text) {
    const lines = text.split('\n');
    return lines.map(line => {
      if (line.match(/^\d+[\.)]\s/)) {
        return line.trim();
      }
      if (line.match(/^[-•*]\s/)) {
        return `- ${line.trim().substring(2)}`;
      }
      return line;
    }).join('\n');
  }

  formatParagraphs(text) {
    return text
      .replace(/\n{3,}/g, '\n\n')
      .replace(/([^\n])\n([^\n])/g, '$1 $2')
      .trim();
  }
}

module.exports = PDFToMarkdown;