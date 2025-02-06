const fs = require('fs');
const pdf = require('pdf-parse');
const sanitize = require('sanitize-filename');

class PDFToMarkdown {
  constructor() {
    this.hyperlinks = new Map();
  }

  async convertFile(pdfPath, outputPath = null) {
    try {
      const dataBuffer = fs.readFileSync(pdfPath);
      
      // Set custom page renderer to extract hyperlinks
      const options = {
        pagerender: this.renderPage.bind(this)
      };

      const data = await pdf(dataBuffer, options);
      const markdown = this.processContent(data);

      if (outputPath) {
        fs.writeFileSync(sanitize(outputPath), markdown);
      }

      return markdown;
    } catch (error) {
      console.error('Conversion failed:', error);
      throw error;
    }
  }

  async renderPage(pageData) {
    try {
      const textContent = await pageData.getTextContent({
        normalizeWhitespace: true,
        disableCombineTextItems: false,
        includeMarkedContent: true
      });

      // Extract text and hyperlinks from the page
      const { text, links } = this.extractPageContent(textContent);
      
      // Store hyperlinks for this page
      if (links.length > 0) {
        this.hyperlinks.set(pageData.pageNumber, links);
      }

      return text;
    } catch (error) {
      console.error('Error in renderPage:', error);
      return '';
    }
  }

  extractPageContent(textContent) {
    let text = '';
    let lastY;
    const links = [];
    let currentLinkText = null;

    for (let i = 0; i < textContent.items.length; i++) {
      const item = textContent.items[i];
      const nextItem = textContent.items[i + 1];
      
      // Handle line breaks
      if (lastY !== undefined && lastY !== item.transform[5]) {
        text += '\n';
      }
      
      // Check if this item has link data
      if (item.hasLinks || item.linkService || item.dest || item.url) {
        if (!currentLinkText) {
          currentLinkText = {
            text: item.str,
            url: item.url || item.dest,
            start: text.length
          };
        } else {
          currentLinkText.text += item.str;
        }
        
        // Check if this is the end of the link
        if (!nextItem?.hasLinks && !nextItem?.linkService) {
          currentLinkText.end = text.length + item.str.length;
          links.push(currentLinkText);
          currentLinkText = null;
        }
      } else if (currentLinkText) {
        // End current link if we hit non-link text
        currentLinkText.end = text.length;
        links.push(currentLinkText);
        currentLinkText = null;
      }

      text += item.str;
      lastY = item.transform[5];
    }

    // Handle any remaining link
    if (currentLinkText) {
      currentLinkText.end = text.length;
      links.push(currentLinkText);
    }

    return { text, links };
  }

  processContent(pdfData) {
    let text = pdfData.text;

    // Process any hyperlinks found
    for (const [pageNum, links] of this.hyperlinks) {
      for (const link of links) {
        if (link.text && link.url) {
          const markdownLink = `[${link.text}](${link.url})`;
          
          // Replace the text with the markdown link
          // We use substring positions to ensure we're replacing the correct occurrence
          const beforeText = text.substring(0, link.start);
          const afterText = text.substring(link.end);
          text = beforeText + markdownLink + afterText;
        }
      }
    }

    // Basic text formatting
    text = text
      .replace(/\r\n/g, '\n')
      .replace(/([^\n])\n([^\n])/g, '$1 $2')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return text;
  }
}

module.exports = PDFToMarkdown;