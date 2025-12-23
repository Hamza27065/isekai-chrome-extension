# Isekai Chrome Extension

[![Release](https://img.shields.io/github/v/release/isekai-sh/isekai-chrome-extension?style=flat-square)](https://github.com/isekai-sh/isekai-chrome-extension/releases/latest)
[![License](https://img.shields.io/github/license/isekai-sh/isekai-chrome-extension?style=flat-square)](https://github.com/isekai-sh/isekai-chrome-extension/blob/main/LICENSE)
[![Build](https://img.shields.io/github/actions/workflow/status/isekai-sh/isekai-chrome-extension/release.yml?style=flat-square)](https://github.com/isekai-sh/isekai-chrome-extension/actions)
[![Documentation](https://img.shields.io/badge/docs-isekai.sh-blue?style=flat-square)](https://isekai.sh/chrome-extension)

Browser extension to help artists manage DeviantArt exclusive sales efficiently. Works seamlessly with your [Isekai](https://isekai.sh) deployment.

## Purpose

DeviantArt's official API does not provide programmatic access to exclusive sales management. This extension bridges that gap for professional artists managing large portfolios. It operates respectfully - opening each page once, processing the form, and closing immediately, ensuring no unnecessary load on DeviantArt's servers.

## Features

- **Sales Management Assistant**: Helps you process exclusive sales from your organized queue
- **Your Account**: Uses your actual DeviantArt login - you remain in control at all times
- **Non-Intrusive**: Handles form filling in background tabs while you continue your work
- **Activity Logs**: Detailed logging of all sales operations for business record-keeping
- **Lightweight**: Just ~500KB browser extension, no additional software needed
- **Secure**: Operates entirely in your browser using API key authentication

## Documentation

Complete documentation is available at [isekai.sh/chrome-extension](https://isekai.sh/chrome-extension):

- [Installation Guide](https://isekai.sh/chrome-extension/installation) - Install on Windows, macOS, or Linux
- [Configuration](https://isekai.sh/chrome-extension/configuration) - Set up API URL and API key
- [Usage Guide](https://isekai.sh/chrome-extension/usage) - Learn how to use the popup and console
- [Troubleshooting](https://isekai.sh/chrome-extension/troubleshooting) - Common issues and solutions

## Quick Start

1. Download the latest release from [GitHub Releases](https://github.com/isekai-sh/isekai-chrome-extension/releases/latest)
2. Extract the ZIP file to a permanent location
3. Open `chrome://extensions/` in your browser
4. Enable "Developer mode" (top-right toggle)
5. Click "Load unpacked" and select the extracted folder
6. Configure your API URL and API key in the extension settings
7. Click Start to begin processing jobs

For detailed instructions, see the [Installation Guide](https://isekai.sh/chrome-extension/installation).

## Requirements

- Chrome, Edge, Brave, or any Chromium-based browser
- Running [Isekai Core](https://github.com/isekai-sh/isekai-core) deployment
- DeviantArt account (must be logged in)
- API key from your Isekai instance

## Development

```bash
# Install dependencies
pnpm install

# Development mode with hot reload
pnpm dev

# Build for production
pnpm build

# Type check
pnpm type-check
```

## Architecture

- **Service Worker**: Background script that polls the backend API for pending jobs
- **Content Script**: Injects into DeviantArt pages to perform DOM automation
- **Popup**: Compact toolbar widget for quick status and controls
- **Console**: Full-featured terminal interface for logs and job history

Built with TypeScript, Vite, and Chrome Extension Manifest V3.

## Support

- Documentation: [isekai.sh/chrome-extension](https://isekai.sh/chrome-extension)
- Report Issues: [GitHub Issues](https://github.com/isekai-sh/isekai-chrome-extension/issues)
- Main Project: [Isekai Core](https://github.com/isekai-sh/isekai-core)

## License

MIT - See [LICENSE](./LICENSE) file for details.
