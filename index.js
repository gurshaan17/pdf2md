const fs = require('fs');
const pdf = require('pdf-parse');
const sanitize = require('sanitize-filename');

class PDFToMarkdown {
  constructor(options = {}) {
    this.options = {
      preserveFormatting: true,
      includeImages: false,
      preserveLinks: true,
      ...options
    };
  }

  async convertFile(pdfPath, outputPath = null) {
    try {
      const dataBuffer = fs.readFileSync(pdfPath);
      const pdfData = await pdf(dataBuffer, {
        pagerender: this.renderPage.bind(this)
      });
      
      const markdown = this.processText(pdfData.text, pdfData.hyperlinks || []);
      
      if (outputPath) {
        const sanitizedPath = sanitize(outputPath);
        fs.writeFileSync(sanitizedPath, markdown);
      }
      
      return markdown;
    } catch (error) {
      throw new Error(`Conversion failed: ${error.message}`);
    }
  }

  async renderPage(pageData) {
    const renderOptions = {
      normalizeWhitespace: true,
      disableCombineTextItems: false
    };

    const textContent = await pageData.getTextContent(renderOptions);
    const hyperlinks = [];

    // Extract hyperlinks from the page
    for (const item of textContent.items) {
      if (item.link) {
        hyperlinks.push({
          text: item.str,
          url: item.link,
          page: pageData.pageNumber
        });
      }
    }

    return {
      textContent,
      hyperlinks
    };
  }

  processText(text, hyperlinks) {
    let markdown = text;
    
    // Basic formatting
    markdown = this.detectAndFormatHeaders(markdown);
    markdown = this.detectAndFormatLists(markdown);
    markdown = this.detectAndFormatParagraphs(markdown);
    
    // Process hyperlinks
    if (this.options.preserveLinks && hyperlinks.length > 0) {
      markdown = this.processHyperlinks(markdown, hyperlinks);
    }
    
    return markdown.trim();
  }

  processHyperlinks(text, hyperlinks) {
    let markdown = text;
    
    hyperlinks.forEach(link => {
      // Convert text with hyperlinks to markdown format
      const linkText = link.text.trim();
      if (linkText && link.url) {
        const markdownLink = `[${linkText}](${link.url})`;
        markdown = markdown.replace(linkText, markdownLink);
      }
    });
    
    return markdown;
  }

  // Previous methods remain the same
  detectAndFormatHeaders(text) {
    const lines = text.split('\n');
    return lines.map(line => {
      if (line.match(/^[A-Z\s]{4,}$/)) {
        return `# ${line.trim()}`;
      }
      return line;
    }).join('\n');
  }

  detectAndFormatLists(text) {
    const lines = text.split('\n');
    return lines.map(line => {
      if (line.trim().match(/^\d+[\.\)]/)) {
        return line.trim();
      }
      if (line.trim().match(/^[\-\•\*]/)) {
        return `- ${line.trim().substring(1).trim()}`;
      }
      return line;
    }).join('\n');
  }

  detectAndFormatParagraphs(text) {
    return text.replace(/\n{3,}/g, '\n\n');
  }
}

module.exports = PDFToMarkdown;