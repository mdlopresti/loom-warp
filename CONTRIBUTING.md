# Contributing to NATS MCP Server

Thank you for your interest in contributing to the NATS MCP Server! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How to Contribute](#how-to-contribute)
- [Development Setup](#development-setup)
- [Code Style](#code-style)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)
- [Issue Reporting](#issue-reporting)

## Code of Conduct

This project adheres to the Contributor Covenant Code of Conduct. By participating, you are expected to uphold this code. Please report unacceptable behavior to mike@lopresti.org.

## How to Contribute

We welcome contributions in many forms:

- Bug reports and feature requests
- Documentation improvements
- Code contributions (bug fixes, new features, optimizations)
- Testing and quality assurance
- Examples and usage patterns

## Development Setup

### Prerequisites

- Node.js 18 or later
- npm or yarn
- NATS server with JetStream enabled (for testing)

### Initial Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/your-org/nats-mcp-server.git
   cd nats-mcp-server
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```

4. Start NATS server with JetStream (in a separate terminal):
   ```bash
   # Using local NATS installation
   nats-server -js

   # Or using Docker
   docker run -p 4222:4222 nats:latest -js

   # Or using Docker Compose
   docker-compose up -d
   ```

### Development Workflow

The project includes several npm scripts to streamline development:

- `npm run build` - Compile TypeScript to JavaScript
- `npm run dev` - Watch mode for development (auto-rebuild on changes)
- `npm start` - Run the compiled server
- `npm test` - Run the test suite
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report
- `npm run lint` - Check code style with ESLint
- `npm run lint:fix` - Auto-fix linting issues
- `npm run format` - Format code with Prettier

### Running in Development Mode

1. Start NATS server with JetStream:
   ```bash
   docker-compose up -d
   ```

2. In another terminal, run the development build:
   ```bash
   npm run dev
   ```

3. Test the MCP server by configuring it in Claude Code's `~/.claude/mcp.json`:
   ```json
   {
     "mcpServers": {
       "nats-mcp": {
         "command": "node",
         "args": ["/path/to/nats-mcp-server/dist/index.js"],
         "env": {
           "NATS_URL": "nats://localhost:4222",
           "LOG_LEVEL": "DEBUG"
         }
       }
     }
   }
   ```

## Code Style

This project uses TypeScript with strict type checking enabled. We enforce code style using ESLint and Prettier.

### TypeScript Guidelines

- Use TypeScript for all source files
- Enable strict mode and strict null checks
- Avoid `any` types; use proper type definitions
- Use interfaces for object shapes
- Document public APIs with JSDoc comments

### ESLint Configuration

The project uses `@typescript-eslint` for linting. Key rules:

- 2-space indentation
- Single quotes for strings
- Semicolons required
- No unused variables
- Consistent spacing and formatting

### Prettier Configuration

Prettier is configured to work alongside ESLint:

- 2-space indentation
- Single quotes
- Semicolons required
- 100-character line length
- Trailing commas in multi-line structures

### Before Committing

Always run the following before committing:

```bash
# Format code
npm run format

# Fix linting issues
npm run lint:fix

# Run tests
npm test
```

## Testing

We use Vitest for testing. All new features and bug fixes should include tests.

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode (for development)
npm run test:watch

# Generate coverage report
npm run test:coverage
```

### Writing Tests

- Place test files next to the source files with `.test.ts` extension
- Use descriptive test names that explain what is being tested
- Follow the Arrange-Act-Assert pattern
- Mock external dependencies (NATS connections, etc.)
- Aim for high test coverage, especially for critical paths

Example test structure:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('FeatureName', () => {
  beforeEach(() => {
    // Setup
  });

  afterEach(() => {
    // Cleanup
  });

  it('should perform expected behavior', () => {
    // Arrange
    const input = 'test';

    // Act
    const result = functionUnderTest(input);

    // Assert
    expect(result).toBe('expected');
  });
});
```

## Pull Request Process

1. **Fork the repository** and create a branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following the code style guidelines.

3. **Add tests** for new functionality or bug fixes.

4. **Update documentation** if you're changing functionality:
   - Update README.md for user-facing changes
   - Add JSDoc comments for new public APIs
   - Update relevant sections in this CONTRIBUTING.md if needed

5. **Run the full test suite** and ensure all tests pass:
   ```bash
   npm run lint
   npm run format
   npm run build
   npm test
   ```

6. **Commit your changes** with a clear and descriptive commit message:
   ```bash
   git commit -m "feat: add work queue priority sorting"
   ```

   Follow conventional commit format:
   - `feat:` for new features
   - `fix:` for bug fixes
   - `docs:` for documentation changes
   - `test:` for test additions or changes
   - `refactor:` for code refactoring
   - `chore:` for maintenance tasks

7. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```

8. **Open a Pull Request** against the `main` branch with:
   - Clear title summarizing the change
   - Description explaining what and why
   - Reference to any related issues (e.g., "Fixes #123")
   - Screenshots or examples if applicable

9. **Address review feedback** promptly and professionally.

10. **Wait for approval** from a maintainer. PRs require at least one approval before merging.

### Pull Request Guidelines

- Keep PRs focused on a single feature or fix
- Avoid mixing refactoring with feature changes
- Keep commits atomic and well-organized
- Rebase on main before submitting if needed
- Ensure CI checks pass before requesting review

## Issue Reporting

### Before Opening an Issue

- Search existing issues to avoid duplicates
- Check the README and documentation for solutions
- Try the latest version to see if the issue is already fixed

### Bug Reports

When reporting a bug, include:

1. **Description**: Clear description of the issue
2. **Steps to Reproduce**: Numbered steps to reproduce the behavior
3. **Expected Behavior**: What you expected to happen
4. **Actual Behavior**: What actually happened
5. **Environment**:
   - OS and version
   - Node.js version
   - NATS MCP Server version
   - NATS server version
6. **Logs**: Relevant error messages or logs (set `LOG_LEVEL=DEBUG`)
7. **Configuration**: Your MCP configuration (redact sensitive data)

Example:

```markdown
## Bug Description
Work queue items are not being delivered to agents with matching capabilities.

## Steps to Reproduce
1. Start NATS server with JetStream
2. Register agent with capability "typescript"
3. Broadcast work offer with requiredCapability "typescript"
4. Agent does not receive the work item

## Expected Behavior
Agent should receive work offer via work queue consumer.

## Actual Behavior
No messages are delivered to the agent.

## Environment
- OS: macOS 14.0
- Node.js: 18.17.0
- NATS MCP Server: 1.2.0
- NATS Server: 2.28.2

## Logs
```
[ERROR] Work queue subscription failed: stream not found
```

## Configuration
```json
{
  "mcpServers": {
    "nats-mcp": {
      "command": "nats-mcp-server",
      "env": {
        "NATS_URL": "nats://localhost:4222"
      }
    }
  }
}
```
```

### Feature Requests

When requesting a feature, include:

1. **Use Case**: Describe the problem you're trying to solve
2. **Proposed Solution**: Your suggested implementation (if any)
3. **Alternatives Considered**: Other approaches you've considered
4. **Additional Context**: Any other relevant information

## Questions?

If you have questions about contributing, feel free to:

- Open a discussion in the GitHub Discussions section
- Reach out to the maintainer at mike@lopresti.org
- Check the README for general usage questions

Thank you for contributing to NATS MCP Server!
