# PDF to Markdown Converter

Convert PDF files to Markdown format with support for text formatting, lists, headers, and hyperlinks.

## Installation

```bash
npm install pdf-to-markdown-converter
```

## Usage

```javascript
const PDFToMarkdown = require('pdf-to-markdown-converter');

// Initialize converter
const converter = new PDFToMarkdown({
    preserveFormatting: true,    // Maintain text formatting
    includeImages: false,        // Skip images
    preserveLinks: true          // Convert hyperlinks
});

// Convert single file
try {
    await converter.convertFile('input.pdf', 'output.md');
    console.log('Conversion complete');
} catch (error) {
    console.error('Conversion failed:', error);
}
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| preserveFormatting | boolean | true | Maintain text formatting like headers and lists |
| includeImages | boolean | false | Future support for image extraction |
| preserveLinks | boolean | true | Convert PDF hyperlinks to markdown format |

## Features

- Converts PDF text to Markdown
- Detects and formats headers
- Preserves bullet points and numbered lists
- Converts hyperlinks to markdown format `[text](url)`
- Maintains paragraph structure

## Author

Gurshaan Singh

https://github.com/gurshaan17/